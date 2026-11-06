/**
 * 单机会话状态机（docs/game-mechanics.md §6）。
 *
 * 座位约定（v2.5 随机到达制，用户 2026-11-01）：初始 4 席 = 对手光标 0..3
 * （opponentIds[cursor++ % len]）；**玩家 = 首个 birth_tick ≥ arrivalTick 的内生
 * 出生**（arrivalTick 由 seedOf(S,"arrival") 单抽 u 派生 1+floor(u·tMax)——
 * arrival=1 即旧"首个内生出生"行为；玩家可能在世界任意演化时刻出生，经历刻数
 * 可 < tMax；世界先终局 → unborn）。到达前的出生按光标循环分配对手。
 *
 * 随机流约定（stage_b 口径，写入种子派生 seedOf）：
 * - env = seedOf(S, "env")
 * - arrival = seedOf(S, "arrival")（v2.5 新域——到达刻单抽，独立于 env 流）
 * - 全部预设决策（一选/重选/均匀目标）共享 seedOf(S, "session")——stage_b.py:45-61
 *   用一条流（train2 的 per-slot 流以 stage_b 为准）
 * - 每模型实例一条流 seedOf(S, "model:" + arm)（批量 act 同 train2.py:55-64）
 *
 * 感知过滤不在本层——view.ts 只经 lastResult/env 与自身知识记忆渲染（规格 §7）。
 */
import { DarkForestEnv2 } from "@/lib/engine/env";
import { V25_CONFIG, type EnvConfig } from "@/lib/engine/config";
import { GameRng, seedOf, type Rng } from "@/lib/engine/rng";
import {
    A_BOTHER,
    A_INVADE,
    A_OBSERVE,
    A_STRIKE,
    N_ACTIONS,
    OBS_DIM,
    type TickResult,
} from "@/lib/engine/types";
import { actBatch, type ModelWeights } from "@/lib/opponents/dqn";
import { heuristicAction, pickTarget, presetStateOf, type PresetKind } from "@/lib/opponents/presets";

export type Phase = "queued" | "awaiting-action" | "awaiting-rechoice" | "ended";

export type EndView =
    | { kind: "dead"; cause: string; ticks: number; kills: number; loot: number }
    | { kind: "won"; nAlive: number }
    | { kind: "unborn" };

export interface SoloMatchHooks {
    envRng?: Rng;
    presetRng?: Rng;
    modelRng?: (arm: string) => Rng;
    /** 到达刻 RNG（缺省 GameRng([seedOf(seed,"arrival")])——测试注入口） */
    arrivalRng?: Rng;
}

const EVAL_EPSILON = 0.05; // stage_b 评测口径

export class SoloMatch {
    readonly env: DarkForestEnv2;
    readonly opponentIds: string[];
    /** 最近一次 resolve 的原始结果（感知过滤的输入，view 层消费） */
    lastResult: TickResult | null = null;

    phase: Phase = "queued";
    playerSlot: number | null = null;
    /** 到达刻（1..tMax；玩家 = 首个 birth_tick ≥ 此值的内生出生——用户 2026-11-01） */
    readonly arrivalTick: number;

    private readonly weights: Map<string, ModelWeights>;
    private readonly presetRng: Rng;
    private readonly modelRngs = new Map<string, Rng>();
    private readonly seat = new Map<number, string>(); // slot -> 对手 id
    private cursor = 0; // 对手分配光标（跨全部出生递增，玩家出生不占光标）
    private assignedBirths = 0; // 已处理的内生出生数
    private killsByPlayer = 0;
    private lootByPlayer = 0;
    private pendingRe: Int32Array | null = null;
    private pendingInvader: number | null = null;
    /** 被入侵刻的本刻原动作（重选视图的"保持原动作"数据源） */
    private pendingOriginal: { action: number; target: number } | null = null;
    /** 玩家入席刻快照（v2.5 同刻复用会覆写槽位 spawn_tick——end.ticks 用本值） */
    private playerSpawnTick = 0;
    private end: EndView | null = null;

    constructor(
        seed: number,
        opponentIds: string[],
        weights: Map<string, ModelWeights>,
        cfg: EnvConfig = V25_CONFIG,
        hooks: SoloMatchHooks = {},
    ) {
        if (opponentIds.length === 0) throw new Error("SoloMatch: no opponents selected");
        this.opponentIds = opponentIds;
        this.weights = weights;
        this.env = new DarkForestEnv2(cfg, hooks.envRng ?? new GameRng([seedOf(seed, "env")]));
        this.presetRng = hooks.presetRng ?? new GameRng([seedOf(seed, "session")]);
        // 到达刻（用户 2026-11-01 随机到达制）：1 + floor(u·tMax) ∈ [1, tMax]。
        // arrival=1 ≈ 旧"首个内生出生"行为；晚到达 → 玩家经历刻数 < tMax；
        // 世界先终局（池枯/热寂）→ unborn（既达路径）。
        const arrivalRng = hooks.arrivalRng ?? new GameRng([seedOf(seed, "arrival")]);
        this.arrivalTick = 1 + Math.floor(arrivalRng.uniform() * this.env.cfg.tMax);
        for (const id of opponentIds) {
            if (id === "random" || id === "df" || id === "pacifist") continue;
            const arm = id;
            if (!this.modelRngs.has(arm))
                this.modelRngs.set(
                    arm,
                    hooks.modelRng ? hooks.modelRng(arm) : new GameRng([seedOf(seed, "model:" + arm)]),
                );
            if (!weights.has(arm)) throw new Error(`SoloMatch: missing weights for model ${arm}`);
        }
        this.env.reset();
        // 初始 cohort（reset 直接创建，不在 birth_log 内）：显式登记为对手（光标 0..3）
        const n0 = this.env.cfg.spawnSchedule[0]?.[1] ?? 0;
        for (let i = 0; i < n0; i++)
            this.seat.set(i, this.opponentIds[this.cursor++ % this.opponentIds.length]);
    }

    /** 排队幽灵期：自动逐刻直至玩家出生或 done（无玩家动作）。onQueuedTick：每刻
     *  resolve 后回调——client 的 tracker.update()（v2.5 多刻排队须逐刻视图更新，
     *  ViewTracker 契约"每刻至少一次 update"；出生刻的 log.born 亦经此处理） */
    start(onQueuedTick?: () => void): void {
        while (this.phase === "queued" && !this.env.done) {
            this.runTick(null);
            onQueuedTick?.();
        }
    }

    getPendingInvader(): number | null {
        return this.pendingInvader;
    }

    /** 被入侵刻的本刻原动作（invasion.originalAction 源；仅 awaiting-rechoice 期非空） */
    getPendingOriginal(): { action: number; target: number } | null {
        return this.pendingOriginal;
    }

    stats(): { kills: number; loot: number } {
        return { kills: this.killsByPlayer, loot: this.lootByPlayer };
    }

    getEnd(): EndView | null {
        return this.end;
    }

    /**
     * 玩家一选（awaiting-action）。STRIKE/OBSERVE 允许 target=-1（最近已知兜底）；
     * INVADE/BOTHER 须显式候选（v2.4：揭露无兜底，无目标=无揭露）。
     */
    submitAction(action: number, target: number): void {
        if (this.phase !== "awaiting-action") throw new Error(`SoloMatch: phase ${this.phase}`);
        const row = this.validRow(this.playerSlot as number);
        if (!row[action]) throw new Error(`SoloMatch: invalid action ${action}`);
        if (action === A_INVADE || action === A_BOTHER) {
            const cand = this.candidates(this.playerSlot as number, action);
            if (target < 0 || !cand.includes(target))
                throw new Error("SoloMatch: invade/reveal target not in candidates");
        }
        this.runTick({ action, target });
    }

    /**
     * 受入侵者重选（awaiting-rechoice；用户 2026-11-01 裁定动作格化——任意动作 ∪
     * 反咬）。反咬（6）恒允许（Q9：无需有效目标）；其余动作须为合法 [0,8) 且过
     * 合法掩码（两阶段协议目标不可重选——目标动作沿用本刻原目标/最近已知兜底）。
     */
    submitRechoice(action: number): void {
        if (this.phase !== "awaiting-rechoice") throw new Error(`SoloMatch: phase ${this.phase}`);
        if (action !== 6) {
            if (!Number.isInteger(action) || action < 0 || action >= N_ACTIONS)
                throw new Error(`SoloMatch: invalid rechoice ${action}`);
            const row = this.validRow(this.playerSlot as number);
            if (!row[action]) throw new Error(`SoloMatch: invalid rechoice ${action}`);
        }
        const re = this.pendingRe as Int32Array;
        re[this.playerSlot as number] = action;
        this.pendingRe = null;
        this.pendingInvader = null;
        this.pendingOriginal = null;
        this.finishTick(re);
    }

    /** 取消 = 保持本刻原动作（pendingRe 中玩家行的锁定值）照常结算 */
    cancelRechoice(): void {
        if (this.phase !== "awaiting-rechoice") throw new Error(`SoloMatch: phase ${this.phase}`);
        const re = this.pendingRe as Int32Array;
        this.pendingRe = null;
        this.pendingInvader = null;
        this.pendingOriginal = null;
        this.finishTick(re);
    }

    // ------------------------------------------------------------------ driver

    private validRow(i: number): Uint8Array {
        const v = this.env.valid();
        return v.subarray(i * N_ACTIONS, (i + 1) * N_ACTIONS);
    }

    private candidates(i: number, action: number): number[] {
        const actions = new Int32Array(this.env.n);
        actions[i] = action;
        const mask = this.env.selectTargets(actions);
        const out: number[] = [];
        for (let j = 0; j < this.env.n; j++) if (mask[i * this.env.n + j]) out.push(j);
        return out;
    }

    /** 一次完整刻：AI 一选/目标 + 玩家动作 → beginTick → 受入侵者重选 → resolve */
    private runTick(playerAction: { action: number; target: number } | null): void {
        const env = this.env;
        const n = env.n;
        const valid = env.valid();
        const actions = new Int32Array(n);
        const isModel = (id: string) => id !== "random" && id !== "df" && id !== "pacifist";

        // AI 一选：预设逐席升序共享流；模型按臂分组升序批量
        const byArm = new Map<string, number[]>();
        for (let i = 0; i < n; i++) {
            if (!env.alive[i] || i === this.playerSlot) continue;
            const id = this.seat.get(i);
            if (id === undefined) continue; // 玩家席或未分配
            if (isModel(id)) {
                const seats = byArm.get(id) ?? [];
                seats.push(i);
                byArm.set(id, seats);
            } else {
                actions[i] = heuristicAction(
                    id as PresetKind,
                    valid.subarray(i * N_ACTIONS, (i + 1) * N_ACTIONS),
                    this.presetRng,
                    presetStateOf(this.env, i),
                );
            }
        }
        const fullObs = env.obs(); // obs 与权重无关——每刻一次（四个臂时省 75% obs 开销，评审修复 2026-10-12）
        for (const [arm, seats] of byArm) {
            const w = this.weights.get(arm) as ModelWeights;
            const obsRows: Float32Array[] = [];
            for (const s of seats) obsRows.push(fullObs.subarray(s * OBS_DIM, (s + 1) * OBS_DIM));
            const validRows = seats.map((s) => valid.subarray(s * N_ACTIONS, (s + 1) * N_ACTIONS));
            const acts = actBatch(w, obsRows, validRows, EVAL_EPSILON, this.modelRngs.get(arm) as Rng);
            seats.forEach((s, k) => (actions[s] = acts[k]));
        }
        if (playerAction !== null && this.playerSlot !== null)
            actions[this.playerSlot] = playerAction.action;

        // 目标二选（stage_b_v24 口径：df 专用分支，其余均匀——玩家显式目标已校验）。
        // v2.4 目标请求集 = INVADE/STRIKE/BOTHER/OBSERVE（模型/预制对手的观测与揭露亦带目标）
        const TARGET_ACTIONS: number[] = [A_BOTHER, A_INVADE, A_STRIKE, A_OBSERVE];
        const tmask = env.selectTargets(actions);
        const targets = new Int32Array(n).fill(-1);
        for (let i = 0; i < n; i++) {
            const a = actions[i];
            if (!TARGET_ACTIONS.includes(a)) continue;
            const cand: number[] = [];
            for (let j = 0; j < n; j++) if (tmask[i * n + j]) cand.push(j);
            if (cand.length === 0) continue;
            if (i === this.playerSlot) {
                targets[i] = playerAction !== null ? playerAction.target : -1;
                continue;
            }
            const id = this.seat.get(i);
            if (id === "df")
                targets[i] = pickTarget("df", cand, env.tech, a, this.presetRng, presetStateOf(env, i));
            else if (id !== undefined && isModel(id))
                targets[i] = this.pickModelTarget(id, cand);
            else targets[i] = this.presetRng.choice(cand); // random 与兜底
        }

        const invaded = env.beginTick(actions, targets);
        // 受入侵 AI 立即重选（stage_b_v24.py:55-61）；玩家待模态
        const re = Int32Array.from(actions);
        if (invaded.length > 0) {
            const reValid = env.valid();
            const reObs = env.obs();
            for (const v of invaded) {
                if (v === this.playerSlot) continue;
                const id = this.seat.get(v);
                if (id === undefined) continue;
                if (isModel(id)) {
                    const w = this.weights.get(id) as ModelWeights;
                    const act = actBatch(
                        w,
                        [reObs.subarray(v * OBS_DIM, (v + 1) * OBS_DIM)],
                        [reValid.subarray(v * N_ACTIONS, (v + 1) * N_ACTIONS)],
                        EVAL_EPSILON,
                        this.modelRngs.get(id) as Rng,
                    );
                    re[v] = act[0];
                } else {
                    re[v] = heuristicAction(
                        id as PresetKind,
                        reValid.subarray(v * N_ACTIONS, (v + 1) * N_ACTIONS),
                        this.presetRng,
                        presetStateOf(this.env, v),
                    );
                }
            }
        }
        if (this.playerSlot !== null && invaded.includes(this.playerSlot)) {
            this.pendingRe = re;
            this.pendingInvader = this.env._invaders.get(this.playerSlot) ?? null;
            this.pendingOriginal = { action: actions[this.playerSlot], target: targets[this.playerSlot] };
            this.phase = "awaiting-rechoice";
            return;
        }
        this.finishTick(re);
    }

    private pickModelTarget(arm: string, cand: number[]): number {
        return (this.modelRngs.get(arm) as Rng).choice(cand); // 模型对手目标均匀（stage_b.py:52）
    }

    private finishTick(re: Int32Array): void {
        const env = this.env;
        const result = env.resolve(re);
        this.lastResult = result;

        // 玩家自身行为结果（感知过滤规则①：行为者知情权）。loot_to 长度守卫（评审
        // I-1）：_grow 扩容刻数组按旧 n 分配——增长槽越界读 undefined → NaN 污染。
        // playerSlot 取入席前的值：本刻刚出生的玩家未行动（null → 跳过）。
        if (this.playerSlot !== null) {
            for (const ev of result.info.strike_events)
                if (ev[0] === this.playerSlot && ev[2] === "killed") this.killsByPlayer++;
            for (const inv of result.info.invasions)
                if (inv[0] === this.playerSlot && !inv[2]) this.killsByPlayer++;
            const loot = result.info.loot_to;
            this.lootByPlayer += this.playerSlot < loot.length ? loot[this.playerSlot] : 0;
        }

        // 判死走 **died_this_tick 事件流**而非 env.alive（走查回归 2026-11-04）：
        // v2.5 同刻复用为缺省——玩家死亡的同刻其槽位可能即被复用（alive=1 新住客），
        // alive 判死会漏检 → 游戏不结束、玩家无缝操控新住客。事件流对复用时序免疫
        //（同在线 processDeaths 口径）；同刻复用会在装配前清死因（Q19）→ unknown。
        //
        // **判死先于 assignBirths**（走查回归 2026-11-06 "饿死在第 0 刻"）：到达
        // 出生可能同刻复用刚死的槽位——死亡阶段（4-8）先于出生阶段（10），该槽位
        // 的 died_this_tick 条目属于前任住客；先入席后判死会使新生玩家吃到前任的
        // 死亡事件 → 进入即死（ticks 0、资源条显示新生儿资源）。在线侧 driver.ts
        // 的 settleTick 同序（"先判死后入席"，:314-318）。
        if (this.playerSlot !== null) {
            const died = result.info.died_this_tick.find((d) => d[0] === this.playerSlot);
            if (died !== undefined) {
                this.phase = "ended";
                this.end = {
                    kind: "dead",
                    cause: died[1] === "" ? "unknown" : died[1],
                    ticks: env.t - this.playerSpawnTick,
                    kills: this.killsByPlayer,
                    loot: this.lootByPlayer,
                };
                return;
            }
        }
        this.assignBirths();
        if (result.done) {
            this.phase = "ended";
            this.end =
                this.playerSlot === null
                    ? { kind: "unborn" }
                    : { kind: "won", nAlive: result.info.n_alive };
            return;
        }
        this.phase = this.playerSlot === null ? "queued" : "awaiting-action";
    }

    /**
     * 内生出生席位登记（v2.5 随机到达制，用户 2026-11-01）：**首个 birth_tick ≥
     * arrivalTick 的内生出生 = 玩家**（arrival=1 ≈ 旧"首个内生出生"行为）；更早
     * 的出生按光标循环分配对手。玩家可能踏上复用槽（tick 语义不变）；世界先终局
     *（池枯/热寂）→ unborn。初始 cohort 在构造器内已登记。
     */
    private assignBirths(): void {
        const env = this.env;
        while (this.assignedBirths < env.birth_log.length) {
            const [birthTick, slot] = env.birth_log[this.assignedBirths];
            if (this.playerSlot === null && birthTick >= this.arrivalTick) {
                this.playerSlot = slot;
                this.playerSpawnTick = birthTick; // 入席快照（同刻复用会覆写槽位 spawn_tick）
            } else {
                this.seat.set(slot, this.opponentIds[this.cursor % this.opponentIds.length]);
                this.cursor++;
            }
            this.assignedBirths++;
        }
    }
}
