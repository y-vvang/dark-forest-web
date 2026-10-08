/**
 * 单机会话状态机（docs/game-mechanics.md §6）。
 *
 * 座位约定：初始 4 席 = 对手光标 0..3（opponentIds[cursor++ % len]）；
 * **玩家 = 出生序 4**（首个内生出生，通常第 1 刻——开局池均值 ~100 ≥ 预滚 ≤20）；
 * 此后每次内生出生继续 cursor++ % len 循环。36 槽一次性（Q11）。
 *
 * 随机流约定（stage_b 口径，写入种子派生 seedOf）：
 * - env = seedOf(S, "env")
 * - 全部预设决策（一选/重选/均匀目标）共享 seedOf(S, "session")——stage_b.py:45-61
 *   用一条流（train2 的 per-slot 流以 stage_b 为准）
 * - 每模型实例一条流 seedOf(S, "model:" + arm)（批量 act 同 train2.py:55-64）
 *
 * 感知过滤不在本层——view.ts 只经 lastResult/env 与自身知识记忆渲染（规格 §7）。
 */
import { DarkForestEnv2 } from "@/lib/engine/env";
import { V23_CONFIG } from "@/lib/engine/config";
import { GameRng, seedOf, type Rng } from "@/lib/engine/rng";
import type { TickResult } from "@/lib/engine/types";
import { actBatch, type ModelWeights } from "@/lib/opponents/dqn";
import { heuristicAction, pickTarget, type PresetKind } from "@/lib/opponents/presets";

export type Phase = "queued" | "awaiting-action" | "awaiting-rechoice" | "ended";

export type EndView =
    | { kind: "dead"; cause: string; ticks: number; kills: number; loot: number }
    | { kind: "won"; nAlive: number }
    | { kind: "unborn" };

export interface SoloMatchHooks {
    envRng?: Rng;
    presetRng?: Rng;
    modelRng?: (arm: string) => Rng;
}

/** 玩家 = 出生序 4（初始 cohort 记序 0-3；birth_log 首个条目即内生序 4） */
const PLAYER_BIRTH_ORDINAL = 4;
const EVAL_EPSILON = 0.05; // stage_b 评测口径

export class SoloMatch {
    readonly env: DarkForestEnv2;
    readonly opponentIds: string[];
    /** 最近一次 resolve 的原始结果（感知过滤的输入，view 层消费） */
    lastResult: TickResult | null = null;

    phase: Phase = "queued";
    playerSlot: number | null = null;

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
    private end: EndView | null = null;

    constructor(
        seed: number,
        opponentIds: string[],
        weights: Map<string, ModelWeights>,
        hooks: SoloMatchHooks = {},
    ) {
        if (opponentIds.length === 0) throw new Error("SoloMatch: no opponents selected");
        this.opponentIds = opponentIds;
        this.weights = weights;
        this.env = new DarkForestEnv2(V23_CONFIG, hooks.envRng ?? new GameRng([seedOf(seed, "env")]));
        this.presetRng = hooks.presetRng ?? new GameRng([seedOf(seed, "session")]);
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

    /** 排队幽灵期：自动逐刻直至玩家出生或 done（无玩家动作） */
    start(): void {
        while (this.phase === "queued" && !this.env.done) this.runTick(null);
    }

    getPendingInvader(): number | null {
        return this.pendingInvader;
    }

    stats(): { kills: number; loot: number } {
        return { kills: this.killsByPlayer, loot: this.lootByPlayer };
    }

    getEnd(): EndView | null {
        return this.end;
    }

    /** 玩家一选（awaiting-action）。STRIKE 允许 target=-1（最近兜底）；INVADE 须显式候选。 */
    submitAction(action: number, target: number): void {
        if (this.phase !== "awaiting-action") throw new Error(`SoloMatch: phase ${this.phase}`);
        const row = this.validRow(this.playerSlot as number);
        if (!row[action]) throw new Error(`SoloMatch: invalid action ${action}`);
        if (action === 6) {
            const cand = this.candidates(this.playerSlot as number, action);
            if (target < 0 || !cand.includes(target))
                throw new Error("SoloMatch: invade target not in candidates");
        }
        this.runTick({ action, target });
    }

    /**
     * 受入侵者重选（awaiting-rechoice）。反咬（6）恒允许（Q9：无需有效目标）；
     * 其余动作须过合法掩码（BD 的 tech 门由 env valid 给出）。
     */
    submitRechoice(action: number): void {
        if (this.phase !== "awaiting-rechoice") throw new Error(`SoloMatch: phase ${this.phase}`);
        if (action !== 6) {
            const row = this.validRow(this.playerSlot as number);
            if (!row[action]) throw new Error(`SoloMatch: invalid rechoice ${action}`);
        }
        const re = this.pendingRe as Int32Array;
        re[this.playerSlot as number] = action;
        this.pendingRe = null;
        this.pendingInvader = null;
        this.finishTick(re);
    }

    /** 取消 = 保持本刻原动作（pendingRe 中玩家行的锁定值）照常结算 */
    cancelRechoice(): void {
        if (this.phase !== "awaiting-rechoice") throw new Error(`SoloMatch: phase ${this.phase}`);
        const re = this.pendingRe as Int32Array;
        this.pendingRe = null;
        this.pendingInvader = null;
        this.finishTick(re);
    }

    // ------------------------------------------------------------------ driver

    private validRow(i: number): Uint8Array {
        const v = this.env.valid();
        return v.subarray(i * 10, (i + 1) * 10);
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
                actions[i] = heuristicAction(id as PresetKind, valid.subarray(i * 10, (i + 1) * 10), this.presetRng);
            }
        }
        for (const [arm, seats] of byArm) {
            const w = this.weights.get(arm) as ModelWeights;
            const obsRows: Float32Array[] = [];
            const fullObs = env.obs();
            for (const s of seats) obsRows.push(fullObs.subarray(s * 38, (s + 1) * 38));
            const validRows = seats.map((s) => valid.subarray(s * 10, (s + 1) * 10));
            const acts = actBatch(w, obsRows, validRows, EVAL_EPSILON, this.modelRngs.get(arm) as Rng);
            seats.forEach((s, k) => (actions[s] = acts[k]));
        }
        if (playerAction !== null && this.playerSlot !== null)
            actions[this.playerSlot] = playerAction.action;

        // 目标二选（stage_b 口径：df 专用分支，其余均匀——玩家显式目标已校验）
        const tmask = env.selectTargets(actions);
        const targets = new Int32Array(n).fill(-1);
        for (let i = 0; i < n; i++) {
            const a = actions[i];
            if (a !== 4 && a !== 6) continue;
            const cand: number[] = [];
            for (let j = 0; j < n; j++) if (tmask[i * n + j]) cand.push(j);
            if (cand.length === 0) continue;
            if (i === this.playerSlot) {
                targets[i] = playerAction !== null ? playerAction.target : -1;
                continue;
            }
            const id = this.seat.get(i);
            if (id === "df") targets[i] = pickTarget("df", cand, env.tech, a, this.presetRng);
            else if (id !== undefined && isModel(id))
                targets[i] = this.pickModelTarget(id, cand);
            else targets[i] = this.presetRng.choice(cand); // random 与兜底
        }

        const invaded = env.beginTick(actions, targets);
        // 受入侵 AI 立即重选（stage_b.py:55-61）；玩家待模态
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
                        [reObs.subarray(v * 38, (v + 1) * 38)],
                        [reValid.subarray(v * 10, (v + 1) * 10)],
                        EVAL_EPSILON,
                        this.modelRngs.get(id) as Rng,
                    );
                    re[v] = act[0];
                } else {
                    re[v] = heuristicAction(id as PresetKind, reValid.subarray(v * 10, (v + 1) * 10), this.presetRng);
                }
            }
        }
        if (this.playerSlot !== null && invaded.includes(this.playerSlot)) {
            this.pendingRe = re;
            this.pendingInvader = this.env._invaders.get(this.playerSlot) ?? null;
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
        this.assignBirths();

        // 玩家自身行为结果（感知过滤规则①：行为者知情权）
        if (this.playerSlot !== null) {
            for (const ev of result.info.strike_events)
                if (ev[0] === this.playerSlot && ev[2] === "killed") this.killsByPlayer++;
            for (const inv of result.info.invasions)
                if (inv[0] === this.playerSlot && !inv[2]) this.killsByPlayer++;
            this.lootByPlayer += result.info.loot_to[this.playerSlot];
        }

        if (this.playerSlot !== null && !env.alive[this.playerSlot]) {
            this.phase = "ended";
            this.end = {
                kind: "dead",
                cause: env.death_cause[this.playerSlot],
                ticks: env.t - env.spawn_tick[this.playerSlot],
                kills: this.killsByPlayer,
                loot: this.lootByPlayer,
            };
            return;
        }
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
     * 内生出生席位登记：**首个内生出生 = 玩家**（= 初始 4 席之后的出生序 4），
     * 其余按光标循环分配对手。一次性槽位（Q11）；初始 cohort 在构造器内已登记。
     */
    private assignBirths(): void {
        const env = this.env;
        while (this.assignedBirths < env.birth_log.length) {
            const [, slot] = env.birth_log[this.assignedBirths];
            if (this.assignedBirths === PLAYER_BIRTH_ORDINAL - 4) {
                this.playerSlot = slot; // 第一个内生出生
            } else {
                this.seat.set(slot, this.opponentIds[this.cursor % this.opponentIds.length]);
                this.cursor++;
            }
            this.assignedBirths++;
        }
    }
}
