/**
 * 在线世界驱动：世界记录 → 全量确定性重演（引擎 + 四臂 AI + 每席感知视图）。
 *
 * 时序（tick-in-flight，计划核心）：spawn = reset → stash a₁ → beginTick(1) →
 * stash a₂；此后每个边界 T(k)：resolve(刻 k) → beginTick(k+1)（消耗 stash a_{k+1}
 * ∪ 窗口 k 的人类提交）→ stash a_{k+2}。**AI 一选的决策基线 = 窗口起点的快照
 * S(k) + 本刻入侵警报**——与人类提交窗口所见完全一致（决策平价裁定：人人
 * info→effect 都隔两窗，实验"全体同状态行动"前提的在线化保形）。AI 受害者的
 * 重选在 beginTick 后立即算（同 SoloMatch.runTick 的 stage_b 口径）；人类受害
 * 者的重选由记录在 resolve 时并入（缺席/-1 = 保持原动作）。
 *
 * 重演是记录的纯函数（无墙钟）：AI 动作/引擎态/视图/日志永不落盘。
 */
import { DarkForestEnv2 } from "@/lib/engine/env";
import { GameRng, seedOf, type Rng } from "@/lib/engine/rng";
import {
    A_BOTHER,
    A_OBSERVE,
    A_SILENT,
    A_STRIKE,
    A_INVADE,
    N_ACTIONS,
    OBS_DIM,
    type TickResult,
} from "@/lib/engine/types";
import { actBatch, type ModelWeights } from "@/lib/opponents/dqn";
import type { ViewTracker } from "@/lib/solo/view";
import { ARM_ROTATION, EVAL_EPSILON, ONLINE_ENV_CONFIG } from "./config";
import { closeWindow, openWindow, resolvedTickCount } from "./record";
import { makeTrackerHost, viewForSeat, type SeatHost } from "./tracker-host";
import type { OnlineView, WorldRecord } from "./types";

export interface SeatRuntime {
    token: string;
    host: SeatHost;
    tracker: ViewTracker;
    /** 最新已渲染视图（死亡者冻结于死亡刻——无旁观） */
    view: OnlineView | null;
    /** 死亡视图渲染毕置位——之后跳过 update */
    frozen: boolean;
    kills: number;
    loot: number;
    /** birthSelf 在全日志中的下标（服务端日志投递的出生锚定——跳过预产噪声）。
     *  出生刻的首个 update 恰以 birthSelf 收尾（新生儿知识图为空、无其他可发条目），
     *  故 view.log.length − 1 即锚点。 */
    birthLogIndex: number | null;
}

export interface DriverHooks {
    envRng?: Rng;
    modelRng?: (arm: string) => Rng;
    /** 测试接缝：resolve(k) 后、beginTick(k+1) 前（同 solo 测试的 env 公开接缝哲学） */
    afterResolve?: (state: DriverState, resolvedTick: number) => void;
}

export interface DriverState {
    readonly env: DarkForestEnv2;
    readonly weights: ReadonlyMap<string, ModelWeights>;
    readonly armRngs: Map<string, Rng>;
    /** slot → ARM_ROTATION 索引（-1 = 人类/未出生） */
    readonly seatArm: Int32Array;
    /** token → 出生槽位（重演推导；与 rec.seats 漂移即抛） */
    readonly tokenSlot: Map<string, number>;
    /** token → 席位运行时（含未出生排队者——追 birthSelf 转移） */
    readonly runtimes: Map<string, SeatRuntime>;
    /** 重演后仍未出生的排队 token（花名册尾部） */
    queue: string[];
    /** AI 分配光标（初始 4 席后继续 a→b→c→d 循环） */
    cursor: number;
    resolvedTicks: number;
    /** 开窗中：victim slot → invader slot（逐刻重建） */
    inFlightInvaders: Map<number, number>;
    ended: boolean;
    lastResult: TickResult | null;
    /** 测试计数（文档化接缝）：AI 受害者立即重选的次数 */
    aiRechoices: number;
    /** 内部：暂存的下一刻 AI 一选（决策平价裁定） */
    stash: Int32Array | null;
    /** 白盒接缝：当前 stash 计算时的 env.t（测试断言决策基线=窗口起点） */
    stashBasisTick: number;
    /** 内部：飞行刻的 re 部分向量（AI 重选已并入；人类重选 resolve 时并入） */
    rePartial: Int32Array | null;
    /** 内部：已消费的 birth_log 条数 */
    assignedBirths: number;
}

/**
 * 过期目标降级（提交时合法、刻时失效——如目标已死）：按环境自身语义——
 * strike/observe → -1 最近已知兜底；invade/reveal 须显式目标 → SILENT。
 */
export function downgradeStaleTarget(action: number, target: number, inCand: boolean): [number, number] {
    if (inCand || target < 0) return [action, target];
    if (action === A_STRIKE || action === A_OBSERVE) return [action, -1];
    if (action === A_INVADE || action === A_BOTHER) return [A_SILENT, -1];
    return [action, target];
}

const TARGET_ACTIONS: readonly number[] = [A_BOTHER, A_INVADE, A_STRIKE, A_OBSERVE];

/**
 * 确保花名册中的 token 有席位运行时（幂等）。重演只为**载入时**的花名册建席——
 * 会话中途 join 的新 token 由服务在推队后补建，否则其出生刻 assignBirths 找不到
 * 运行时（2026-10-13 sprint 场景爆出）。
 */
export function ensureRuntime(state: DriverState, token: string): SeatRuntime {
    let rt = state.runtimes.get(token);
    if (rt === undefined) {
        const host: SeatHost = {
            env: state.env,
            phase: "queued",
            playerSlot: null,
            lastResult: null,
            pendingInvader: null,
            end: null,
        };
        rt = {
            token,
            host,
            tracker: makeTrackerHost(host),
            view: null,
            frozen: false,
            kills: 0,
            loot: 0,
            birthLogIndex: null,
        };
        state.runtimes.set(token, rt);
    }
    return rt;
}

export function replay(
    record: WorldRecord,
    weights: ReadonlyMap<string, ModelWeights>,
    hooks: DriverHooks = {},
): DriverState {
    const envRng = hooks.envRng ?? new GameRng([seedOf(record.seed, "env")]);
    const env = new DarkForestEnv2(ONLINE_ENV_CONFIG, envRng);
    const armRngs = new Map<string, Rng>();
    for (const arm of ARM_ROTATION)
        armRngs.set(arm, hooks.modelRng ? hooks.modelRng(arm) : new GameRng([seedOf(record.seed, "model:" + arm)]));

    const state: DriverState = {
        env,
        weights,
        armRngs,
        seatArm: new Int32Array(env.n).fill(-1),
        tokenSlot: new Map(),
        runtimes: new Map(),
        queue: [...record.queue],
        cursor: 0,
        resolvedTicks: 0,
        inFlightInvaders: new Map(),
        ended: false,
        lastResult: null,
        aiRechoices: 0,
        stash: null,
        stashBasisTick: 0,
        rePartial: null,
        assignedBirths: 0,
    };

    env.reset();
    // 初始 cohort = 四臂各一（slot 0..3；reset 直接创建，不在 birth_log 内）
    for (let i = 0; i < 4; i++) state.seatArm[i] = i;
    state.cursor = 4;

    // 排队花名册的虚拟席位（phase=queued——出生刻 tracker 发 birthSelf）
    for (const token of record.queue) ensureRuntime(state, token);

    // spawn 边界 T(0)：stash a₁ → beginTick(1)（无人类提交）→ stash a₂
    state.stash = computeAiActions(state);
    state.stashBasisTick = env.t;
    beginNextTick(state, record, 0);
    state.stash = computeAiActions(state);
    state.stashBasisTick = env.t;
    updateViews(state);

    const R = resolvedTickCount(record);
    for (let k = 1; k <= R; k++) {
        settleTick(state, record, k);
        hooks.afterResolve?.(state, k);
        if (env.done) {
            updateViews(state);
            break;
        }
        beginNextTick(state, record, k);
        state.stash = computeAiActions(state);
        state.stashBasisTick = env.t;
        updateViews(state);
    }
    return state;
}

// ---------------------------------------------------------------- 内部件

/** AI 一选（当前 env 状态上的 greedy；按臂分组升序批量——RNG 消耗序与 solo 平价） */
function computeAiActions(state: DriverState): Int32Array {
    const env = state.env;
    const n = env.n;
    const actions = new Int32Array(n); // SILENT 基底
    const valid = env.valid();
    const obs = env.obs();
    const byArm = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        if (!env.alive[i] || state.seatArm[i] < 0) continue;
        const arm = ARM_ROTATION[state.seatArm[i]];
        const seats = byArm.get(arm);
        if (seats) seats.push(i);
        else byArm.set(arm, [i]);
    }
    for (const [arm, seats] of byArm) {
        const w = state.weights.get(arm);
        if (!w) throw new Error(`driver: missing weights for arm ${arm}`);
        const acts = actBatch(
            w,
            seats.map((s) => obs.subarray(s * OBS_DIM, (s + 1) * OBS_DIM)),
            seats.map((s) => valid.subarray(s * N_ACTIONS, (s + 1) * N_ACTIONS)),
            EVAL_EPSILON,
            state.armRngs.get(arm) as Rng,
        );
        seats.forEach((s, k) => (actions[s] = acts[k]));
    }
    return actions;
}

/** 边界 T(k) 的 beginTick(k+1)：stash a_{k+1} ∪ 窗口 k 的人类提交 → 开窗飞行 */
function beginNextTick(state: DriverState, rec: WorldRecord, k: number): void {
    const env = state.env;
    const n = env.n;
    const actions = Int32Array.from(state.stash ?? new Int32Array(n)); // 拷贝防 env 持有
    const targets = new Int32Array(n).fill(-1);

    // 人类一选：窗口 k 的提交（entry ticks[k-1]；k=0 即 spawn，无）
    const entry = k >= 1 ? rec.ticks[k - 1] : null;
    if (entry) {
        for (const [slotStr, [action, target]] of Object.entries(entry.nextActions)) {
            const slot = Number(slotStr);
            if (!env.alive[slot] || state.seatArm[slot] >= 0) continue; // 死席陈旧提交/AI 席防御
            actions[slot] = action;
            targets[slot] = target;
        }
    }

    // 候选掩码（动作已定型）：AI 目标 = 臂 RNG 均匀；人类过期目标在此降级
    const tmask = env.selectTargets(actions);
    for (let i = 0; i < n; i++) {
        const a = actions[i];
        if (!TARGET_ACTIONS.includes(a)) continue;
        const cand: number[] = [];
        for (let j = 0; j < n; j++) if (tmask[i * n + j]) cand.push(j);
        if (state.seatArm[i] >= 0) {
            if (cand.length > 0)
                targets[i] = (state.armRngs.get(ARM_ROTATION[state.seatArm[i]]) as Rng).choice(cand);
        } else if (entry && entry.nextActions[String(i)] !== undefined) {
            const submitted = entry.nextActions[String(i)];
            const [a2, t2] = downgradeStaleTarget(a, submitted[1], cand.includes(submitted[1]));
            actions[i] = a2;
            targets[i] = t2;
        }
    }

    const invaded = env.beginTick(actions, targets);

    // re 部分向量：AI 受害者立即重选（beginTick 后的 obs/valid——含警报情报）
    const re = Int32Array.from(actions);
    if (invaded.length > 0) {
        const reValid = env.valid();
        const reObs = env.obs();
        for (const v of invaded) {
            if (state.seatArm[v] < 0) continue; // 人类受害者：窗口内提交
            const arm = ARM_ROTATION[state.seatArm[v]];
            const act = actBatch(
                state.weights.get(arm) as ModelWeights,
                [reObs.subarray(v * OBS_DIM, (v + 1) * OBS_DIM)],
                [reValid.subarray(v * N_ACTIONS, (v + 1) * N_ACTIONS)],
                EVAL_EPSILON,
                state.armRngs.get(arm) as Rng,
            );
            re[v] = act[0];
            state.aiRechoices++;
        }
    }
    state.rePartial = re;
    state.inFlightInvaders = new Map(env._invaders);
}

/** resolve(刻 k)：re = AI 重选（开窗时已算）∪ 窗口 k 的人类重选（-1 = 保持原动作） */
function settleTick(state: DriverState, rec: WorldRecord, k: number): void {
    const env = state.env;
    const re = state.rePartial ?? new Int32Array(env.n);
    const entry = rec.ticks[k - 1]; // 窗口 k 的条目：刻 k 的人类重选
    for (const [slotStr, action] of Object.entries(entry.rechoices)) {
        if (action === -1) continue; // 明确保持原动作（协议兼容保留；无快进后与缺席等价）
        re[Number(slotStr)] = action;
    }
    const result = env.resolve(re);
    state.lastResult = result;
    state.resolvedTicks = k;
    state.inFlightInvaders = new Map();
    state.rePartial = null;
    accumulateStats(state, result);
    assignBirths(state, rec);
    processDeaths(state, result);
    if (env.done) markWorldEnd(state);
}

/** 击杀/缴获累计（solo finishTick 模式：strike_events/invasions/loot_to） */
function accumulateStats(state: DriverState, result: TickResult): void {
    for (const rt of state.runtimes.values()) {
        const p = rt.host.playerSlot;
        if (p === null) continue;
        for (const ev of result.info.strike_events)
            if (ev[0] === p && ev[2] === "killed") rt.kills++;
        for (const inv of result.info.invasions)
            if (inv[0] === p && !inv[2]) rt.kills++;
        rt.loot += result.info.loot_to[p];
    }
}

/**
 * 内生出生席位：FIFO 弹出**加入早于本次出生**的队首（joinedAt < 出生序；缺省 0 =
 * 世界起点）→ 人类；空档 → AI 轮替（cursor 继续 a→b→c→d）。加入时刻入档使全量
 * 重演与活期弹出同构——否则中途加入者被幻影配对到更早的历史出生席（确定论缺陷，
 * 评审轮 2026-10-14）。配对与 rec.seats 档案校验（漂移即抛——腐记录绊网）。
 */
function assignBirths(state: DriverState, rec: WorldRecord): void {
    const env = state.env;
    while (state.assignedBirths < env.birth_log.length) {
        const ordinal = state.assignedBirths + 1; // 本次出生序（1 起）
        const [, slot] = env.birth_log[state.assignedBirths];
        const eligible = state.queue.findIndex((t) => (rec.joinedAt[t] ?? 0) < ordinal);
        const token = eligible !== -1 ? state.queue.splice(eligible, 1)[0] : undefined;
        if (token !== undefined) {
            const known = rec.seats[token];
            if (known !== undefined && known !== slot)
                throw new Error(`driver: seat drift for ${token}: record ${known} vs env ${slot}`);
            state.tokenSlot.set(token, slot);
            const rt = state.runtimes.get(token);
            if (rt === undefined) throw new Error(`driver: seated token ${token} missing runtime`);
            rt.host.playerSlot = slot;
            rt.host.phase = "awaiting-action";
            state.seatArm[slot] = -1; // 人类席
        } else {
            state.seatArm[slot] = state.cursor % ARM_ROTATION.length;
            state.cursor++;
        }
        state.assignedBirths++;
    }
}

/**
 * 人类席位死亡 → 终局视图（死亡视图渲染后由 updateViews 冻结）。
 * 判死用 **died_this_tick**（resolve 装配的事件流）而非 env.alive——对复用时序
 * 免疫（评审 Critical #2 纵深：任何"死后槽位被重生"的路径都不会把新住客的
 * alive=1 误读为死者存活）。
 */
function processDeaths(state: DriverState, result: TickResult): void {
    const env = state.env;
    for (const ev of result.info.died_this_tick) {
        const slot = ev[0];
        const cause = ev[1];
        for (const rt of state.runtimes.values()) {
            if (rt.host.playerSlot !== slot || rt.host.end !== null) continue;
            rt.host.end = {
                kind: "dead",
                cause,
                ticks: env.t - env.spawn_tick[slot],
                kills: rt.kills,
                loot: rt.loot,
            };
        }
    }
}

/** 世界终局：存活人类 → won；仍在队 → unborn（死者终局已由 processDeaths 定） */
function markWorldEnd(state: DriverState): void {
    state.ended = true;
    const nAlive = state.lastResult?.info.n_alive ?? 0;
    for (const rt of state.runtimes.values()) {
        if (rt.host.end !== null) continue;
        if (rt.host.playerSlot === null) rt.host.end = { kind: "unborn" };
        else if (state.env.alive[rt.host.playerSlot]) rt.host.end = { kind: "won", nAlive };
    }
}

/** 全席视图刷新（每 resolve 后与开窗后各一次；契约：每刻恰一次 processTick） */
function updateViews(state: DriverState): void {
    for (const rt of state.runtimes.values()) {
        if (rt.frozen) continue;
        const host = rt.host;
        host.lastResult = state.lastResult;
        if (host.end !== null) {
            host.phase = "ended";
            host.pendingInvader = null;
        } else if (host.playerSlot === null) {
            host.phase = "queued";
            host.pendingInvader = null;
        } else if (state.inFlightInvaders.has(host.playerSlot)) {
            host.phase = "awaiting-rechoice";
            host.pendingInvader = state.inFlightInvaders.get(host.playerSlot) ?? null;
        } else {
            host.phase = "awaiting-action";
            host.pendingInvader = null;
        }
        rt.view = viewForSeat(rt.tracker);
        if (rt.birthLogIndex === null && host.playerSlot !== null)
            rt.birthLogIndex = rt.view.log.length - 1; // 出生锚点：首视图以 birthSelf 收尾
        if (host.end !== null && host.end.kind === "dead") rt.frozen = true; // 无旁观
    }
}

// ------------------------------------------------ 服务推进面（窗口机器）

/**
 * 冲刺谓词：**零存活人类且工作队列空**——无观察者的世界批量结算至终局，为下
 * 一位加入者清场。"全员提前提交则提前结算"的快进谓词已删（用户 2026-10-14：
 * AI 一等公民，每刻恒满 20s——早结算压缩窗口，入侵倒计时条/时间戳皆不可调试；
 * 有存活人类 ⇒ 恒不满刻，即使全员已提交）。
 */
export function sprintDue(state: DriverState, rec: WorldRecord): boolean {
    if (state.ended || rec.status !== "running") return false;
    const open = rec.ticks[rec.ticks.length - 1];
    if (open === undefined || open.endedAtMs !== null) return false;
    for (const rt of state.runtimes.values()) {
        const p = rt.host.playerSlot;
        if (p !== null && state.env.alive[p]) return false; // 有存活人类 → 满时长
    }
    return state.queue.length === 0;
}

/**
 * 结算飞行中的刻（服务推进步）：re = rePartial（AI 受害者开窗即重选）∪ 开窗条目的
 * 人类重选（-1 = 保持原动作，协议兼容）。nowMs = 结算时刻——**冲刺 = now
 * （无观察者清场）；追赶 = 原截止（窗口墙钟链不漂移）**。返回是否世界终局。
 * afterResolve 与重演循环同刻同位触发——测试接缝在 live settle 与 replay 间保持
 * 逐刻一致（否则注入态只存在于重演，重放即漂移）。
 */
export function settleCurrent(
    state: DriverState,
    rec: WorldRecord,
    nowMs: number,
    afterResolve?: DriverHooks["afterResolve"],
): boolean {
    const k = state.resolvedTicks + 1;
    settleTick(state, rec, k);
    afterResolve?.(state, k);
    closeWindow(rec, nowMs);
    if (state.env.done) {
        rec.status = "ended";
        rec.endedAtMs = nowMs;
        updateViews(state);
        return true;
    }
    openWindow(rec, nowMs);
    beginNextTick(state, rec, k);
    state.stash = computeAiActions(state);
    state.stashBasisTick = state.env.t;
    updateViews(state);
    return false;
}
