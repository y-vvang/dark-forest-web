/**
 * 感知过滤 + 视图模型（docs/game-mechanics.md §7 规则表，严格忠实口径）。
 *
 * info 流是全知的；本层只渲染玩家在环境机制下真正可知的信息——宁可少知道，
 * 不给环境没赋予的信息。规则①-⑪的实现锚点：
 *  ① 自有动作结果（strike_events/invasions 中玩家为行为者；OBSERVE 情报 = observed 行增量）
 *  ② 入侵通知（env2.py:353-359 显式机制 → log.invaded + invasion 视图）
 *  ③ 自身探测（known[player,·] 增量、非公开路径 → log.contact 坐标，无 tech/res）
 *  ④ 公开广播（public 0→1 且 known 增量 → log.broadcast）
 *  ⑤ 自身全状态 + 世界 HUD（刻/存活数/自由池——自由池不在 obs 中，为明示的 HUD 偏离）
 *  ⑥ 已知存活集缩差 → log.dark（无死因；玩家自身知识图的变化）
 *  ⑦ 他人间交锋不产生日志（detections/strikes 以玩家为一方为界）
 *  ⑧ 被观测反曝光不可见（known[other, player] 变化不进本层——只 diff 玩家的 known 行）
 *  ⑨ 被打击幸存无通知（strike_events 不含目标侧渲染）
 *  ⑩ 出生情报-free（n_births 增量 → log.born，无 id/资源）
 *  ⑪ 他人 tech/res 需 OBSERVE（observed 行增量即①的观测所得）
 *
 * 日志条目约定：`params.cause` 携带 cause.* 键名，由 EventLog 嵌套翻译。
 */
import type { MessageKey, TParams } from "@/i18n";
import { A_BALL, A_BOTHER, N_ACTIONS } from "@/lib/engine/types";
import { relativeDelta } from "./camera";
import type { EndView, Phase, SoloMatch } from "./match";
import {
    ARM_IDS,
    addIngredients,
    armParamsOf,
    emptyIngredients,
    partsOf,
    rewardOf,
    type RewardIngredients,
} from "./rewards";

export interface MarkerView {
    id: number;
    x: number;
    y: number;
    state: "self" | "queued" | "known" | "observed" | "public" | "domain";
    /** 已观测者的精确情报（封存者显示冻结值） */
    tech?: number;
    res?: number;
}

export interface LogEntryView {
    tick: number;
    key: MessageKey;
    params?: TParams;
}

/** 奖励展示（用户 2026-10-10 口径：配置流 + 四臂对比）——出生前为 null */
export interface RewardView {
    /** 当前配置累计（Σ 引擎 rewards[p]，精确） */
    total: number;
    /** 当前配置本刻增量 */
    lastTick: number;
    /** 当前配置下的累计分量明细 */
    parts: { stipend: number; res: number; bounty: number; bdEntry: number; death: number };
    /** v2.4 四臂累计对比（固定臂参数，与开局配置无关） */
    arms: { id: string; total: number }[];
}

export interface MatchView {
    phase: Phase;
    tick: number;
    tMax: number;
    nAlive: number;
    freePool: number;
    self: { slot: number; tech: number; res: number; inDomain: boolean; windup: boolean } | null;
    markers: MarkerView[];
    /** 玩家本刻合法动作（env valid 行） */
    valid: boolean[];
    /** 目标候选（selectTargets 玩家行；四目标动作共用） */
    targetCandidates: number[];
    invasion: { invaderId: number } | null;
    end: EndView | null;
    /** 奖励展示（未生 null） */
    reward: RewardView | null;
    /** 自身面板读数域 + 行动门理由（配置注入后与 V24_CONFIG 可能不同——读 env.cfg） */
    panel: { gateObserveTech: number; gateStrikeTech: number; resMax: number };
    /** 会话环境配置（供行动格门理由/入侵模态理由读真实门槛） */
    cfg: import("@/lib/engine/config").EnvConfig;
    /** 累计日志快照（tracker.getLog()） */
    log: LogEntryView[];
}

export class ViewTracker {
    /**
     * 契约：**每刻至少调用一次 update()**（UI 的 reducer 逐刻派发恰好保证）。
     * 只处理最近一次未消费的 resolve 结果——跳刻会漏该刻事件。
     */
    private log: LogEntryView[] = [];
    private prevKnown = new Set<number>();
    private prevObserved = new Set<number>();
    private prevKnownAlive = new Set<number>();
    private prevPublic = new Set<number>();
    /** 域封存情报：slot → 声明刻末（风窗刻末）的 tech/res 快照（评审 Important 1 修复） */
    private frozenIntel = new Map<number, { tech: number; res: number }>();
    private prevBirths = 0;
    private prevHadPlayer = false;
    private lastResultSeen: unknown = null;
    private waitBirthLogged = false;
    private invadedLogged = false;
    private lastInvader: number | null = null;
    private deathLogged = false;
    /** 奖励累计（玩家；配置流 total + 原料） */
    private cumReward = 0;
    private lastTickReward = 0;
    private cumIng: RewardIngredients = emptyIngredients();

    constructor(private readonly m: SoloMatch) {}

    getLog(): LogEntryView[] {
        return this.log;
    }

    private emit(tick: number, key: MessageKey, params?: TParams): void {
        this.log.push({ tick, key, params });
    }

    update(): MatchView {
        const m = this.m;
        const env = m.env;
        const n = env.n;

        if (m.phase === "queued" && !this.waitBirthLogged) {
            this.waitBirthLogged = true;
            this.emit(env.t, "match.waitBirth");
        }
        if (m.phase === "awaiting-rechoice" && !this.invadedLogged) {
            this.invadedLogged = true;
            const invader = m.getPendingInvader();
            this.lastInvader = invader;
            this.emit(env.t + 1, "log.invaded", { id: invader ?? 0 });
        } else if (m.phase !== "awaiting-rechoice") {
            this.invadedLogged = false;
        }

        const r = m.lastResult;
        if (r !== null && r !== this.lastResultSeen) {
            this.lastResultSeen = r;
            this.processTick(env.t, r);
        }

        // ---- 视图装配（当前状态直读） ----
        const p = m.playerSlot;
        let markers: MarkerView[] = [];
        let valid: boolean[] = new Array(N_ACTIONS).fill(false);
        const targetCandidates: number[] = [];
        if (p === null) {
            markers = [{ id: -1, x: 50, y: 50, state: "queued" }];
        } else {
            markers = [
                {
                    id: p,
                    x: env.pos[p * 2],
                    y: env.pos[p * 2 + 1],
                    state: env.in_domain[p] ? "domain" : "self",
                    tech: env.tech[p],
                    res: env.res[p],
                },
            ];
            for (let j = 0; j < n; j++) {
                if (j === p || !env.known[p * n + j] || !env.alive[j]) continue;
                const isDomain = env.in_domain[j] === 1;
                const state: MarkerView["state"] = isDomain
                    ? "domain"
                    : env.public_[j]
                      ? "public"
                      : env.observed[p * n + j]
                        ? "observed"
                        : "known";
                // 域内者：封存快照（活值 = 泄漏，评审 Important 1）；观测者：live 值——
                // env 语义即 observed 置位后近邻块逐刻喂 tech[order]/res[order] 当前值
                const frozen = isDomain ? this.frozenIntel.get(j) : undefined;
                const hasLiveIntel = !isDomain && env.observed[p * n + j] === 1;
                markers.push({
                    id: j,
                    x: env.pos[j * 2],
                    y: env.pos[j * 2 + 1],
                    state,
                    tech: frozen !== undefined ? frozen.tech : hasLiveIntel ? env.tech[j] : undefined,
                    res: frozen !== undefined ? frozen.res : hasLiveIntel ? env.res[j] : undefined,
                });
            }
            const vRow = env.valid().subarray(p * N_ACTIONS, (p + 1) * N_ACTIONS);
            valid = [...vRow].map((x) => x === 1);
            const probe = new Int32Array(n);
            probe[p] = 4; // STRIKE（候选掩码与四目标动作同——env2_v24.py:350-356）
            const mask = env.selectTargets(probe);
            for (let j = 0; j < n; j++) if (mask[p * n + j]) targetCandidates.push(j);
        }

        return {
            phase: m.phase,
            tick: env.t,
            tMax: env.cfg.tMax,
            nAlive: r ? r.info.n_alive : countAlive(env),
            freePool: env.free_pool,
            self:
                p === null
                    ? null
                    : {
                          slot: p,
                          tech: env.tech[p],
                          res: env.res[p],
                          inDomain: env.in_domain[p] === 1,
                          windup: env.domain_windup[p] === 1,
                      },
            markers,
            valid,
            targetCandidates,
            invasion: m.phase === "awaiting-rechoice" ? { invaderId: m.getPendingInvader() ?? 0 } : null,
            end: m.getEnd(),
            // 奖励展示（未生 null）：配置流（精确引擎值）+ 四臂（原料 × 固定臂参数）
            reward:
                p === null
                    ? null
                    : {
                          total: this.cumReward,
                          lastTick: this.lastTickReward,
                          parts: partsOf(this.cumIng, env.cfg),
                          arms: ARM_IDS.map((id) => ({ id, total: rewardOf(this.cumIng, armParamsOf(id)) })),
                      },
            panel: {
                gateObserveTech: env.cfg.gateObserveTech,
                gateStrikeTech: env.cfg.gateStrikeTech,
                resMax: env.cfg.resMax,
            },
            cfg: env.cfg,
            // 快照拷贝：React Compiler 缓存元素，同一数组引用会让 memo 化的 EventLog
            // 永不重渲染（用户手测回归 2026-10-08——日志冻结在出生消息）
            log: [...this.log],
        };
    }

    /** 结算刻的感知过滤（规则①②③④⑥⑩）——只在 lastResult 变化时执行一次 */
    private processTick(tick: number, r: import("@/lib/engine/types").TickResult): void {
        const m = this.m;
        const env = m.env;
        const n = env.n;
        const p = m.playerSlot;

        // ⑩ 出生（恰一次；玩家自身出生 → birthSelf）
        if (r.info.n_births > this.prevBirths) {
            const justBornSelf = !this.prevHadPlayer && p !== null;
            this.emit(tick, justBornSelf ? "match.birthSelf" : "log.born");
            this.prevBirths = r.info.n_births;
        }
        this.prevHadPlayer = p !== null;

        if (p === null) return; // 未生：无知识图可 diff

        // 奖励累计（配置流 total 用引擎精确值；原料供四臂/分量组合）
        this.lastTickReward = r.rewards[p];
        this.cumReward += r.rewards[p];
        addIngredients(this.cumIng, r.rewardDetail, r.deadNow, p);

        // ① 自有动作结果
        for (const ev of r.info.strike_events) {
            if (ev[0] !== p) continue; // ⑦⑨：他人/受害侧不渲染
            if (ev[2] === "killed") this.emit(tick, "log.ownStrikeHit", { id: ev[1] });
            else if (ev[2] === "survived") this.emit(tick, "log.ownStrikeMiss", { id: ev[1] });
            else this.emit(tick, "log.ownStrikeBlocked", { id: ev[1], take: ev[5].toFixed(1) });
        }
        for (const inv of r.info.invasions) {
            if (inv[0] === p && !inv[2])
                this.emit(tick, "log.ownInvade", {
                    id: inv[1],
                    loot: r.info.loot_to[p].toFixed(1),
                });
        }
        if (env.last_action[p] === A_BALL) this.emit(tick, "log.ownBroadcast");
        // ①(v2.4) 揭露成功（last_action=BOTHER 且揭露确实入队——阶段 3 可能静默拦下：
        // 目标在锁定后、入队前转入 in_domain（阶段 0 域激活先于阶段 3）。虚报=感知失真，
        // 以 pending_reveal 的实际入队为准（评审修复 2026-10-12））。
        if (env.last_action[p] === A_BOTHER) {
            const j = env._targets.get(p);
            if (
                j !== undefined &&
                env.pending_reveal.some((e) => e[0] === "other" && e[1] === j)
            ) {
                this.emit(tick, "log.ownReveal", { id: j });
            }
        }

        // ③④ 已知增量（自身 known 行 diff；公开路径 → broadcast，否则 → contact）
        const knownNow = new Set<number>();
        const publicNow = new Set<number>();
        for (let j = 0; j < n; j++) {
            if (env.known[p * n + j] && j !== p) knownNow.add(j);
            if (env.public_[j]) publicNow.add(j);
        }
        for (const j of knownNow) {
            if (this.prevKnown.has(j)) continue;
            if (j === this.lastInvader) continue; // ②：入侵通知已表达（log.invaded）
            if (publicNow.has(j) && !this.prevPublic.has(j)) {
                this.emit(tick, "log.broadcast", { id: j }); // ④
            } else {
                // ③：相对坐标（评审 I1 修正，2026-10-09）——星图为自身相对（相机居中），
                // 日志坐标须与星图同构（玩家不知自己的世界坐标，绝对坐标会失联）；
                // 自身位置对玩家已知，环面差无感知泄漏
                const { dx, dy } = relativeDelta(
                    env.pos[j * 2],
                    env.pos[j * 2 + 1],
                    env.pos[p * 2],
                    env.pos[p * 2 + 1],
                );
                this.emit(tick, "log.contact", {
                    x: fmtDelta(dx),
                    y: fmtDelta(dy),
                });
            }
        }

        // ① OBSERVE 成果（observed 行增量 = 精确情报）
        for (let j = 0; j < n; j++) {
            if (!env.observed[p * n + j] || this.prevObserved.has(j)) continue;
            if (!env.known[p * n + j]) continue; // 只报已观测目标（防御）
            this.emit(tick, "log.observed", {
                id: j,
                tech: env.tech[j].toFixed(1),
                res: env.res[j].toFixed(1),
            });
            this.prevObserved.add(j);
        }

        // 域封存情报快照（评审 Important 1）：**风窗刻末** = 环境喂 live 情报的最后时刻
        // ——env2.py:313 的 known_pair 只滤 ~in_domain 不滤 windup，观测情报在声明刻末
        // 仍在喂当前值，域生效刻起才掩蔽。此时快照恰为玩家可知的最后值（精确，非近似）。
        // in_domain 分支是跳刻（契约破坏）时的安全网——宁可冻结偏旧值也不跟随活值。
        for (let j = 0; j < n; j++) {
            if (j === p || this.frozenIntel.has(j)) continue;
            if (!env.known[p * n + j] || env.observed[p * n + j] !== 1) continue;
            if (env.domain_windup[j] === 1 || env.in_domain[j] === 1) {
                this.frozenIntel.set(j, { tech: env.tech[j], res: env.res[j] });
            }
        }

        // ⑥ 已知信号消失（无死因）
        const knownAliveNow = new Set<number>();
        for (let j = 0; j < n; j++) {
            if (j !== p && env.known[p * n + j] && env.alive[j]) knownAliveNow.add(j);
        }
        for (const j of this.prevKnownAlive) {
            if (!knownAliveNow.has(j)) this.emit(tick, "log.dark");
        }
        // ⑥b 槽复用配套（仅 cfg.slotReuse 世界可达）：**known 列被引擎复位**为驱逐
        // 判据——true→false 仅复用发生（env 的 known 永不遗忘，死亡不清列）。以
        // 死亡为判据是错的（评审 Critical #1）：下一刻 knownNow 重建时死者重新入
        // 集，而 prevKnown 已删 ⇒ 幻影 contact（死者坐标）+ 幻影 observed（**死者
        // 临终 tech/res**——规则③⑪情报泄漏），单机同样中招。非复用路径此循环恒
        // 不触发（prevKnown 与 knownNow 都含死而不忘的 j）——实验零行为差。
        for (const j of this.prevKnown) {
            if (knownNow.has(j)) continue;
            this.prevKnown.delete(j);
            this.prevObserved.delete(j);
            this.frozenIntel.delete(j);
        }

        // 死亡（终态）：log.death；cause 传键名，EventLog 嵌套翻译
        const end = m.getEnd();
        if (end !== null && end.kind === "dead" && !this.deathLogged) {
            this.deathLogged = true;
            this.emit(tick, "log.death", { cause: `cause.${end.cause}`, ticks: end.ticks });
        }

        this.prevKnown = knownNow;
        this.prevKnownAlive = knownAliveNow;
        this.prevPublic = publicNow;
        this.lastInvader = null;
    }
}

function countAlive(env: { alive: Uint8Array }): number {
    let c = 0;
    for (const a of env.alive) if (a) c++;
    return c;
}

/** 有符号整数（−0 归 0）——contact 坐标格式，与居中星图的环面差同构 */
function fmtDelta(d: number): string {
    const r = Math.round(d);
    return r === 0 ? "0" : r > 0 ? `+${r}` : `${r}`;
}
