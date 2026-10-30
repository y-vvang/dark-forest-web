/**
 * 在线服务（计划架构节）：join/leave/getState/submitAction/submitRechoice 的编排层。
 *
 * 每个变更操作 = 持全局锁 → 载入（缓存命中或全量读+重演）→ 变更 → advance
 * （心跳剪除 / 冲刺 / 到点追赶环 / 新配对入档）→ CAS 写回 → 响应。
 * 轮询 getState 锁忙时跳过推进、服务当前缓存态（最终一致，下次追上）。
 * 时钟/种子/token/世界号全部可注入（同 Rng 注入惯例）；driverHooks 为工厂——
 * ScriptedRng 等有状态流不可跨重演共享。
 */
import {
    A_BDOMAIN,
    A_BOTHER,
    A_INVADE,
    A_OBSERVE,
    A_STRIKE,
    N_ACTIONS,
} from "@/lib/engine/types";
import { LOCK_WAIT_MS } from "./config";
import { getWeights } from "./ai";
import {
    ensureRuntime,
    replay,
    settleCurrent,
    sprintDue,
    type DriverHooks,
} from "./driver";
import { OnlineError } from "./http";

export { OnlineError } from "./http";
import { cachedCtx, dropCtx, putCtx, withLock, type WorldCtx } from "./hub";
import {
    assertRecordSize,
    currentDeadline,
    inFlightTick,
    newWorldRecord,
    openTickEntry,
    pruneQueue,
    resolvedTickCount,
} from "./record";
import type { WorldStore } from "./store";
import type {
    QueueResponse,
    StateResponse,
    Timing,
    WorldReadout,
    WorldRecord,
} from "./types";

export interface OnlineService {
    join(token?: string): Promise<QueueResponse>;
    leave(token: string): Promise<void>;
    getState(token: string | null, since: number): Promise<StateResponse>;
    submitAction(token: string, tick: number, action: number, target: number): Promise<StateResponse>;
    submitRechoice(token: string, tick: number, action: number): Promise<StateResponse>;
}

export interface ServiceOptions {
    store: WorldStore;
    clock: () => number;
    makeSeed?: () => number;
    makeToken?: () => string;
    makeWorldId?: () => string;
    /** 每次重演生成新钩子（有状态 RNG 流的跨重演隔离） */
    driverHooks?: () => DriverHooks;
}

const LOCK_WORLD = "world";
const TARGET_ACTIONS: ReadonlySet<number> = new Set([
    A_BOTHER,
    A_INVADE,
    A_STRIKE,
    A_OBSERVE,
]);

function randomHex(nBytes: number): string {
    const bytes = new Uint8Array(nBytes);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createOnlineService(opts: ServiceOptions): OnlineService {
    const store = opts.store;
    const clock = opts.clock;
    const makeSeed = opts.makeSeed ?? (() => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) >>> 1);
    const makeToken = opts.makeToken ?? (() => randomHex(16)); // 128-bit
    const makeWorldId = opts.makeWorldId ?? (() => randomHex(4));
    const driverHooks = opts.driverHooks;
    const weights = getWeights();

    // ---------------------------------------------------------------- 载入/写回

    async function idxCtx(): Promise<WorldCtx | null> {
        const idx = await store.readIndex();
        if (idx === null) return null;
        const hit = cachedCtx(idx.worldId, idx.v);
        if (hit !== undefined) return hit;
        const rec = await store.readRecord(idx.worldId);
        if (rec === null) return null;
        const ctx: WorldCtx = { rec, state: replay(rec, weights, driverHooks?.()), version: rec.v };
        putCtx(ctx);
        return ctx;
    }

    async function persist(ctx: WorldCtx): Promise<void> {
        const expected = ctx.version;
        ctx.rec.v = expected + 1; // 写入方置 expected+1（store CAS 约定）
        assertRecordSize(ctx.rec); // 64KB 体积目标的监控兜底（评审 Important #3）
        const ok = await store.writeRecord(ctx.rec.worldId, ctx.rec, expected);
        if (!ok) {
            // 陈旧写者（锁过期竞态）：**必须弃缓存**——否则本实例此后永远命中陈旧
            // 版本、CAS 永远失败，世界对该实例砖化（评审 Important #2 深层后果）。
            // 弃后下一次载入按库内版本自愈（一次 500 的代价）。
            dropCtx(ctx.rec.worldId);
            throw new Error("online: version conflict (lock expiry?)");
        }
        ctx.version = ctx.rec.v;
        await store.writeIndex({ worldId: ctx.rec.worldId, v: ctx.rec.v });
        putCtx(ctx);
    }

    /** 播种：新世界（终局滚动时携旧队列未入座者；随后删旧记录） */
    async function spawn(
        nowMs: number,
        carried: string[],
        joinTok: string | null,
        oldId: string | null,
    ): Promise<WorldCtx> {
        const rec = newWorldRecord(makeWorldId(), makeSeed(), nowMs);
        const queue = [...carried];
        if (joinTok !== null && !queue.includes(joinTok)) queue.push(joinTok);
        rec.queue = queue;
        const ctx: WorldCtx = { rec, state: replay(rec, weights, driverHooks?.()), version: rec.v };
        const ok = await store.writeRecord(rec.worldId, rec, 0);
        if (!ok) throw new Error("online: spawn conflict");
        await store.writeIndex({ worldId: rec.worldId, v: rec.v });
        if (oldId !== null) {
            await store.deleteRecord(oldId);
            dropCtx(oldId);
        }
        putCtx(ctx);
        if (joinTok !== null) await store.touchHeartbeat(joinTok, nowMs);
        return ctx;
    }

    /**
     * 推进环：心跳剪除（工作队列同步防幽灵入座）→ 冲刺/到点结算（无快进——AI
     * 一等公民，每刻恒满 20s；到点锚原截止——墙钟链不漂移）→ 新配对入档。
     * 返回记录是否变更。
     */
    async function advance(ctx: WorldCtx, nowMs: number): Promise<boolean> {
        const { rec, state } = ctx;
        let changed = false;
        if (rec.queue.some((t) => rec.seats[t] === undefined)) {
            const hbs = await store.readHeartbeats(rec.queue);
            const removed = pruneQueue(rec, hbs, nowMs);
            if (removed.length > 0) {
                changed = true;
                const gone = new Set(removed);
                state.queue = state.queue.filter((t) => !gone.has(t));
            }
        }
        let guard = 0;
        const afterResolve = driverHooks?.().afterResolve;
        while (!state.ended) {
            if (sprintDue(state, rec)) settleCurrent(state, rec, nowMs, afterResolve);
            else if (nowMs >= currentDeadline(rec))
                settleCurrent(state, rec, currentDeadline(rec), afterResolve);
            else break;
            changed = true;
            if (++guard > 400) break; // 250 刻 + 余量（防御）
        }
        for (const [tok, slot] of state.tokenSlot)
            if (rec.seats[tok] === undefined) {
                rec.seats[tok] = slot;
                changed = true;
            }
        return changed;
    }

    // ---------------------------------------------------------------- 响应装配

    function readoutOf(ctx: WorldCtx): WorldReadout {
        const { rec, state } = ctx;
        let nAlive = 0;
        for (const a of state.env.alive) if (a) nAlive++;
        return {
            tick: rec.status === "ended" ? resolvedTickCount(rec) : inFlightTick(rec),
            tMax: state.env.cfg.tMax,
            nAlive,
            freePool: state.env.free_pool,
        };
    }

    function timingOf(ctx: WorldCtx, nowMs: number): Timing {
        const { rec } = ctx;
        if (rec.status === "ended")
            return {
                serverNowMs: nowMs,
                tickEndsAtMs: 0,
                remainingSeconds: 0,
                tick: resolvedTickCount(rec),
                worldVersion: rec.v,
            };
        const dl = currentDeadline(rec);
        return {
            serverNowMs: nowMs,
            tickEndsAtMs: dl,
            remainingSeconds: Math.max(0, Math.ceil((dl - nowMs) / 1000)),
            tick: inFlightTick(rec),
            worldVersion: rec.v,
        };
    }

    /** 1-based 队位（只在未入座者中计） */
    function positionOf(rec: WorldRecord, token: string): number {
        let pos = 0;
        for (const t of rec.queue) {
            if (rec.seats[t] === undefined) pos++;
            if (t === token) return pos;
        }
        return 0;
    }

    /**
     * 状态响应。logSince：0 = 出生锚定全量日志（join/重入）；null = 不带日志
     * （提交/重选响应——事件由下一次轮询的增量送达）；number = 条数游标增量。
     * 成员资格以记录为准（seats → console；queue → lobby；否则 unknown-token）。
     */
    function respond(
        ctx: WorldCtx,
        token: string,
        nowMs: number,
        rolledOver: boolean,
        logSince: number | null,
    ): StateResponse {
        const { rec, state } = ctx;
        const slot = rec.seats[token];
        if (slot !== undefined) {
            const rt = state.runtimes.get(token);
            if (rt === undefined || rt.view === null) throw new OnlineError("unknown-token");
            const anchor = rt.birthLogIndex ?? 0;
            const delta =
                logSince === null ? [] : rt.view.log.slice(anchor + Math.max(0, logSince));
            const open = rec.status === "running" ? openTickEntry(rec) : null;
            const sub = open !== null ? open.nextActions[String(slot)] : undefined;
            return {
                kind: "console",
                token,
                timing: timingOf(ctx, nowMs),
                view: { ...rt.view, log: delta },
                submission: sub !== undefined ? { action: sub[0], target: sub[1] } : null,
            };
        }
        if (rec.queue.includes(token))
            return {
                kind: "lobby",
                token,
                timing: timingOf(ctx, nowMs),
                world: readoutOf(ctx),
                queuePosition: positionOf(rec, token),
                rolledOver,
            };
        throw new OnlineError("unknown-token");
    }

    /** 变更类操作的锁忙兜底：等待 LOCK_WAIT_MS 后放弃（理论上锁 TTL ≫ 推进耗时）。
     *  Promise<never> = 底部类型——对任意 () => Promise<T> 皆可赋值，T 推断全归 fn。
     *  语义化为 503 server-busy（走查回归 2026-10-28：裸 500 在日志里与真缺陷
     *  不可辨；锁竞争是可重试的过载，非服务器错误）。 */
    async function busyThrow(): Promise<never> {
        throw new OnlineError("server-busy");
    }

    // ---------------------------------------------------------------- 操作面

    async function join(token?: string): Promise<QueueResponse> {
        const requested = token ?? makeToken();
        const result = await withLock(
            store,
            LOCK_WORLD,
            async (): Promise<{ token: string; state: StateResponse }> => {
                const now = clock();
                const cur = await idxCtx();
                if (cur !== null && cur.rec.status === "ended") {
                    // 终局世界：滚动播种（"再排一次"/新加入都入新世界队列）
                    const carried = cur.rec.queue.filter((t) => cur.rec.seats[t] === undefined);
                    const next = await spawn(now, carried, requested, cur.rec.worldId);
                    return { token: requested, state: respond(next, requested, now, true, 0) };
                }
                if (cur !== null) {
                    let tok = requested;
                    const seat = cur.rec.seats[requested];
                    if (seat !== undefined) {
                        const rt = cur.state.runtimes.get(requested);
                        if (rt !== undefined && rt.host.end !== null) {
                            // **死席 join = 再排队**（用户 2026-10-14：多次进出世界，
                            // 每次都应重新排队；旧实现把死席当"已在册"幂等 no-op，
                            // "再排一次"永远返回死亡遮罩 = 死循环）。换发新 token：
                            // 每命一新 ⇒ 一 token 永不两次出生 ⇒ 配对档案恒一致、
                            // 重演安全；旧 token 留在旧花名册/档案（该世界的历史成员，
                            // 其 getState 仍返回冻结终局视图）。
                            tok = makeToken();
                        }
                    }
                    let changed = false;
                    if (!cur.rec.queue.includes(tok)) {
                        cur.rec.queue.push(tok);
                        cur.rec.joinedAt[tok] = resolvedTickCount(cur.rec); // 加入时刻（重演同构）
                        cur.state.queue.push(tok); // 工作队列同步——否则下一刻结算的
                        // FIFO 弹出看不见新排队者（其出生会错落给 AI 轮替）
                        ensureRuntime(cur.state, tok); // 中途 join 补建席位运行时
                        changed = true;
                    }
                    if (cur.rec.seats[tok] === undefined) await store.touchHeartbeat(tok, now);
                    if (await advance(cur, now)) changed = true;
                    if (changed) await persist(cur);
                    return { token: tok, state: respond(cur, tok, now, false, 0) };
                }
                const next = await spawn(now, [], requested, null); // 无世界：首访播种
                return { token: requested, state: respond(next, requested, now, false, 0) };
            },
            busyThrow,
            LOCK_WAIT_MS,
        );
        return result;
    }

    async function leave(token: string): Promise<void> {
        await withLock(
            store,
            LOCK_WORLD,
            async () => {
                const now = clock();
                const cur = await idxCtx();
                if (cur === null) throw new OnlineError("unknown-token");
                const { rec, state } = cur;
                if (rec.seats[token] !== undefined) return; // 已入座：无离席（无自杀）
                if (!rec.queue.includes(token)) throw new OnlineError("unknown-token");
                rec.queue = rec.queue.filter((t) => t !== token);
                delete rec.joinedAt[token];
                state.queue = state.queue.filter((t) => t !== token);
                await advance(cur, now);
                await persist(cur);
            },
            busyThrow,
            LOCK_WAIT_MS,
        );
    }

    async function getState(token: string | null, since: number): Promise<StateResponse> {
        const now = clock();
        if (token === null) {
            const cur = await idxCtx();
            if (cur === null) return { kind: "lobby-public", world: null };
            return { kind: "lobby-public", world: readoutOf(cur) };
        }
        // 未入座者心跳（入座者只读——带宽纪律）
        const pre = await idxCtx();
        if (pre !== null && pre.rec.seats[token] === undefined && pre.rec.queue.includes(token))
            await store.touchHeartbeat(token, now);
        let ctx: WorldCtx | null = pre;
        let rolledOver = false;
        await withLock(
            store,
            LOCK_WORLD,
            async () => {
                const now2 = clock();
                const cur = await idxCtx();
                if (cur === null) {
                    ctx = null;
                    return;
                }
                if (await advance(cur, now2)) await persist(cur);
                if (
                    cur.rec.status === "ended" &&
                    cur.rec.seats[token] === undefined &&
                    cur.rec.queue.includes(token)
                ) {
                    // advance 后终局且仍在队（未出生）→ 滚动播种（携队，旧记录删除）
                    const carried = cur.rec.queue.filter((t) => cur.rec.seats[t] === undefined);
                    ctx = await spawn(now2, carried, token, cur.rec.worldId);
                    rolledOver = true;
                    return;
                }
                ctx = cur;
            },
            () => {
                /* 锁忙：服务预载态（最终一致，下次轮询追上） */
                return Promise.resolve();
            },
            0,
        );
        if (ctx === null) throw new OnlineError("unknown-token");
        return respond(ctx, token, clock(), rolledOver, since);
    }

    /** 席位解析：返回 slot；未入座/未知 → OnlineError（not-born / unknown-token） */
    function seatOf(cur: WorldCtx, token: string): number {
        const slot = cur.rec.seats[token];
        if (slot === undefined)
            throw new OnlineError(cur.rec.queue.includes(token) ? "not-born" : "unknown-token");
        return slot;
    }

    async function submitAction(
        token: string,
        tick: number,
        action: number,
        target: number,
    ): Promise<StateResponse> {
        return withLock(
            store,
            LOCK_WORLD,
            async (): Promise<StateResponse> => {
                const now = clock();
                const cur = await idxCtx();
                if (cur === null) throw new OnlineError("unknown-token");
                const slot = seatOf(cur, token);
                const { rec, state } = cur;
                if (rec.status === "ended" || state.env.alive[slot] === 0)
                    throw new OnlineError("not-born"); // 无可行动文明
                if (tick !== inFlightTick(rec)) throw new OnlineError("stale-tick");
                if (!Number.isInteger(action) || action < 0 || action >= N_ACTIONS)
                    throw new OnlineError("invalid-action");
                const rt = state.runtimes.get(token);
                if (rt === undefined || rt.view === null) throw new OnlineError("unknown-token");
                if (!rt.view.valid[action]) throw new OnlineError("invalid-action"); // 尽力而为；env 为最终权威
                if (TARGET_ACTIONS.has(action)) {
                    const inCand = rt.view.targetCandidates.includes(target);
                    const needsExplicit = action === A_INVADE || action === A_BOTHER;
                    if (needsExplicit ? target < 0 || !inCand : target !== -1 && !inCand)
                        throw new OnlineError("invalid-action");
                }
                openTickEntry(rec).nextActions[String(slot)] = [action, target]; // 后写覆盖
                await advance(cur, now); // 到点结算在此触发（无快进——恒满 20s）
                await persist(cur);
                return respond(cur, token, now, false, null);
            },
            busyThrow,
            LOCK_WAIT_MS,
        );
    }

    async function submitRechoice(
        token: string,
        tick: number,
        action: number,
    ): Promise<StateResponse> {
        return withLock(
            store,
            LOCK_WORLD,
            async (): Promise<StateResponse> => {
                const now = clock();
                const cur = await idxCtx();
                if (cur === null) throw new OnlineError("unknown-token");
                const slot = seatOf(cur, token);
                const { rec, state } = cur;
                if (rec.status === "ended" || state.env.alive[slot] === 0 || !state.inFlightInvaders.has(slot))
                    throw new OnlineError("not-invaded");
                if (tick !== inFlightTick(rec)) throw new OnlineError("stale-tick");
                if (action !== -1 && action !== A_BDOMAIN && action !== A_INVADE)
                    throw new OnlineError("invalid-action");
                if (action === A_BDOMAIN) {
                    const rt = state.runtimes.get(token);
                    if (rt === undefined || rt.view === null || !rt.view.valid[A_BDOMAIN])
                        throw new OnlineError("invalid-action"); // BD 门 tech>5（尽力而为）
                }
                openTickEntry(rec).rechoices[String(slot)] = action;
                await advance(cur, now); // 重选落库（结算恒在到点）
                await persist(cur);
                return respond(cur, token, now, false, null);
            },
            busyThrow,
            LOCK_WAIT_MS,
        );
    }

    return { join, leave, getState, submitAction, submitRechoice };
}
