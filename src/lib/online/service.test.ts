import { expect, test } from "bun:test";

import { ScriptedRng, type Rng } from "@/lib/engine/rng";
import { MemoryStore } from "./memory-store";
import { dropCtx } from "./hub";
import { createOnlineService, OnlineError, type OnlineService } from "./service";
import type { ConsoleView, ErrorCode, LobbyView, StateResponse } from "./types";
import type { DriverState } from "./driver";

// 配方同 driver.test.ts（自包含测试文件惯例）
function baseEnvRng(fill: number) {
    return new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5], fill);
}
const QUIET = 0.05;

async function rejects(p: Promise<unknown>, expected: ErrorCode) {
    let caught: unknown;
    try {
        await p;
    } catch (e) {
        caught = e;
    }
    expect(caught).toBeInstanceOf(OnlineError);
    expect((caught as OnlineError).code).toBe(expected);
}

function makeService(inject?: (s: DriverState, k: number) => void) {
    const store = new MemoryStore();
    let now = 0;
    let n = 0;
    let w = 0;
    const svc: OnlineService = createOnlineService({
        store,
        clock: () => now,
        makeSeed: () => 7,
        makeToken: () => `tok${++n}`,
        makeWorldId: () => `w${++w}`,
        driverHooks: () => ({
            envRng: baseEnvRng(QUIET),
            modelRng: (): Rng => new ScriptedRng([], 0.5),
            afterResolve: inject,
        }),
    });
    return {
        svc,
        store,
        /** 前进一个刻长（20s） */
        tick: () => {
            now += 20_000;
        },
        jump: (ms: number) => {
            now += ms;
        },
    };
}

function consoleOf(s: StateResponse): ConsoleView {
    if (s.kind !== "console") throw new Error(`expected console, got ${s.kind}`);
    return s;
}
function lobbyOf(s: StateResponse): LobbyView {
    if (s.kind !== "lobby") throw new Error(`expected lobby, got ${s.kind}`);
    return s;
}

const INJECT_KNOWN = (s: DriverState, k: number) => {
    if (k === 2) s.env.known[4 * 36 + 5] = 1;
};

test("join: spawns a world, issues tokens, positions FIFO, rejoin idempotent", async () => {
    const h = makeService();
    const a = await h.svc.join();
    expect(a.token).toBe("tok1");
    const la = lobbyOf(a.state);
    expect(la.queuePosition).toBe(1);
    expect(la.world.tick).toBe(1); // 飞行中刻号
    expect(la.world.nAlive).toBe(4);
    expect(la.world.freePool).toBeCloseTo(110, 5); // 150 − 4×10
    expect(la.rolledOver).toBe(false);

    const b = await h.svc.join();
    expect(b.token).toBe("tok2");
    expect(lobbyOf(b.state).queuePosition).toBe(2);
    const a2 = await h.svc.join(a.token); // 幂等重入
    expect(a2.token).toBe("tok1");
    expect(lobbyOf(a2.state).queuePosition).toBe(1);
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    expect(rec!.queue).toEqual(["tok1", "tok2"]); // 花名册无重复
});

test("getState(null): lobby-public before and after spawn", async () => {
    const h = makeService();
    expect(await h.svc.getState(null, 0)).toEqual({ kind: "lobby-public", world: null });
    await h.svc.join();
    const s = await h.svc.getState(null, 0);
    if (s.kind !== "lobby-public") throw new Error("expected lobby-public");
    expect(s.world!.tick).toBe(1);
});

test("getState: FIFO birth → console with birth-anchored log", async () => {
    const h = makeService();
    const a = await h.svc.join();
    const b = await h.svc.join();
    h.tick(); // 结算刻 1 → tok1 出生
    const sa = consoleOf(await h.svc.getState(a.token, 0));
    expect(sa.view.self?.slot).toBe(4);
    expect(sa.view.phase).toBe("awaiting-action");
    expect(sa.view.log[0].key).toBe("match.birthSelf"); // 出生锚定：无 waitBirth 噪声
    expect(sa.submission).toBeNull();
    expect(sa.timing.tick).toBe(2); // 刻 2 飞行中
    expect(lobbyOf(await h.svc.getState(b.token, 0)).queuePosition).toBe(1);
    h.tick(); // 刻 2 → tok2 出生
    const sb = consoleOf(await h.svc.getState(b.token, 0));
    expect(sb.view.self?.slot).toBe(5);
    expect(sb.view.log[0].key).toBe("match.birthSelf");
});

test("submitAction: happy path, last-write-wins, no early settle, error taxonomy", async () => {
    const h = makeService();
    const a = await h.svc.join();
    const b = await h.svc.join();
    h.tick();
    h.tick();
    const sa = consoleOf(await h.svc.getState(a.token, 0)); // 推进：两者出生；刻 3 飞行
    const t = sa.timing.tick; // 3
    const r1 = consoleOf(await h.svc.submitAction(a.token, t, 1, -1));
    expect(r1.submission).toEqual({ action: 1, target: -1 }); // b 未提交 → 不快进
    const r2 = consoleOf(await h.svc.submitAction(a.token, t, 0, -1));
    expect(r2.submission).toEqual({ action: 0, target: -1 }); // 后写覆盖
    await rejects(h.svc.submitAction(a.token, 99, 1, -1), "stale-tick");
    await rejects(h.svc.submitAction(a.token, t, 9, -1), "invalid-action");
    await rejects(h.svc.submitAction(a.token, t, 6, -1), "invalid-action"); // invade 须显式目标
    await rejects(h.svc.submitAction(a.token, t, 6, 5), "invalid-action"); // 目标不在候选
    const c = await h.svc.join(); // 未出生即提交（刻 3 尚未结算 → 仍在队）
    await rejects(h.svc.submitAction(c.token, t, 0, -1), "not-born");
    await rejects(h.svc.submitAction("ghost", t, 0, -1), "unknown-token");
    // 不快进：最后一人提交后该刻仍飞行满 20s（AI 一等公民）
    const rb = consoleOf(await h.svc.submitAction(b.token, t, 0, -1));
    expect(rb.timing.tick).toBe(t);
    expect(rb.submission).toEqual({ action: 0, target: -1 });
});

test("submissions do not settle early — every tick runs the full window (AI first-class)", async () => {
    // 用户 2026-10-14：全员提交不再提前结算——AI 一等公民，每刻恒满 20s
    const h = makeService();
    const a = await h.svc.join();
    const b = await h.svc.join();
    h.tick();
    h.tick(); // 两者出生；刻 3 飞行
    const sa = consoleOf(await h.svc.getState(a.token, 0));
    const t = sa.timing.tick; // 3
    await h.svc.submitAction(a.token, t, 0, -1);
    const rb = consoleOf(await h.svc.submitAction(b.token, t, 0, -1)); // 最后一人提交
    expect(rb.timing.tick).toBe(t); // 不快进：刻 3 仍飞行
    expect(rb.submission).toEqual({ action: 0, target: -1 });
    expect(rb.view.tick).toBe(2); // 世界仍在 S(2)
    h.tick(); // 到点
    const next = consoleOf(await h.svc.getState(a.token, 0));
    expect(next.timing.tick).toBe(t + 1); // 满刻后推进
});

test("invasion: counter → mutual; same-tick log entries both delivered; dead view frozen", async () => {
    const h = makeService(INJECT_KNOWN);
    const a = await h.svc.join(); // tok1 → slot4
    const b = await h.svc.join(); // tok2 → slot5
    h.tick();
    h.tick();
    consoleOf(await h.svc.getState(a.token, 0)); // 推进：刻 1、2 结算 → 两者出生；刻 3 飞行
    await h.svc.submitAction(a.token, 3, 6, 5); // 窗 3 提交入侵（known 由接缝注入）
    h.tick(); // 结算刻 3 → 刻 4 飞行，tok2 受害
    const sb1 = consoleOf(await h.svc.getState(b.token, 0));
    expect(sb1.view.invasion).toEqual({ invaderId: 4 });
    // 出生锚定 + 受害通知（env.t+1——与同刻结算事件同刻号）；其余条目为世界噪声
    expect(sb1.view.log[0].key).toBe("match.birthSelf");
    const invaded = sb1.view.log.find((e) => e.key === "log.invaded");
    expect(invaded?.tick).toBe(4);
    // 重选错误分类：未受害的 tok1 → not-invaded；BD 门 tech>5 未过 → invalid-action
    await rejects(h.svc.submitRechoice(a.token, 4, 6), "not-invaded");
    await rejects(h.svc.submitRechoice(b.token, 4, 5), "invalid-action");
    const held = sb1.view.log.length; // 客户端持有数 = 条数游标
    const empty = consoleOf(await h.svc.getState(b.token, held)); // 无新事件 → 空增量
    expect(empty.view.log).toEqual([]);
    await h.svc.submitRechoice(b.token, 4, 6); // 反咬
    h.tick(); // 到点 → 结算发生在下一次轮询的 advance
    const sb2 = consoleOf(await h.svc.getState(b.token, held));
    expect(sb2.view.end).toMatchObject({ kind: "dead", cause: "mutual" });
    // 条数游标回归：死亡刻（4）的条目全数送达（log.death 必在，不丢同刻事件）
    const death = sb2.view.log.find((e) => e.key === "log.death");
    expect(death?.tick).toBe(4);
    // 死亡视图冻结：再轮询无增量、终局不变
    const sb3 = consoleOf(await h.svc.getState(b.token, held + sb2.view.log.length));
    expect(sb3.view.log).toEqual([]);
    expect(sb3.view.end).toMatchObject({ kind: "dead", cause: "mutual" });
    const sa2 = consoleOf(await h.svc.getState(a.token, 0));
    expect(sa2.view.end).toMatchObject({ kind: "dead", cause: "mutual" });
});

test("invasion: rechoice -1 keeps the original action (expiry semantics, explicit)", async () => {
    const h = makeService(INJECT_KNOWN);
    const a = await h.svc.join();
    const b = await h.svc.join();
    h.tick();
    h.tick();
    consoleOf(await h.svc.getState(a.token, 0)); // 推进：两者出生；刻 3 飞行
    await h.svc.submitAction(a.token, 3, 6, 5);
    h.tick();
    consoleOf(await h.svc.getState(b.token, 0)); // 推进：刻 3 结算 → 刻 4 飞行，tok2 受害
    await h.svc.submitAction(a.token, 4, 0, -1); // 入侵者提交窗 4 动作
    await h.svc.submitAction(b.token, 4, 0, -1); // 受害者同样提交窗 4 动作
    const rb = await h.svc.submitRechoice(b.token, 4, -1); // 明确保持原动作（不再触发快进）
    if (rb.kind !== "console") throw new Error("expected console");
    expect(rb.timing.tick).toBe(4); // 刻 4 仍飞行——满 20s
    h.tick(); // 到点
    const sb = consoleOf(await h.svc.getState(b.token, 1));
    expect(sb.view.end).toMatchObject({ kind: "dead", cause: "invade" }); // 截止保原 → 死
    const sa = consoleOf(await h.svc.getState(a.token, 1));
    expect(sa.view.self).not.toBeNull(); // 入侵者存活
});

test("leave: unseated removed (token void), seated no-op, unknown 404", async () => {
    const h = makeService();
    const a = await h.svc.join();
    const b = await h.svc.join();
    await h.svc.leave(b.token); // 未出生即离队
    await rejects(h.svc.getState(b.token, 0), "unknown-token");
    h.tick();
    consoleOf(await h.svc.getState(a.token, 0)); // 推进 → tok1 出生
    await h.svc.leave(a.token); // 已出生 → no-op
    expect(consoleOf(await h.svc.getState(a.token, 0)).view.self).not.toBeNull();
    await rejects(h.svc.leave("ghost"), "unknown-token");
});

test("queue heartbeat pruning: silent queued token pruned on advance", async () => {
    const h = makeService();
    const a = await h.svc.join();
    for (let i = 0; i < 10; i++) {
        h.tick();
        await h.svc.getState(a.token, 0); // a 心跳 + 推进
    }
    const q = await h.svc.join(); // 加入后即沉默（AFK）
    // 跳变 41s 且**无任何中继轮询**——advance 先剪除后结算 ⇒ q 不可能在剪除前
    // 被出生（世界不因无人请求而推进）。新鲜心跳的存活由 record.test 的
    // pruneQueue 单测覆盖（服务层仅验剪除的触发与 404 语义）。
    h.jump(41_000);
    await h.svc.getState(a.token, 99); // a 的轮询触发 advance → 剪除 q
    await rejects(h.svc.getState(q.token, 0), "unknown-token");
});

test("catch-up to t_max: alive member wins; AFK queued token pruned; next joiner spawns fresh", async () => {
    const h = makeService();
    const a = await h.svc.join();
    for (let i = 0; i < 10; i++) {
        h.tick();
        await h.svc.getState(a.token, 0);
    }
    const q = await h.svc.join(); // 加入后即沉默（AFK）
    h.jump(250 * 20_000);
    const sa = consoleOf(await h.svc.getState(a.token, 999)); // a 推进：追赶至 250；q 超时被剪
    expect(sa.view.end).toMatchObject({ kind: "won" });
    expect(sa.view.phase).toBe("ended");
    expect(sa.timing.tick).toBe(250);
    await rejects(h.svc.getState(q.token, 0), "unknown-token"); // AFK 排队者已被剪除
    const c = await h.svc.join(); // 新访客 → join 见终局世界 → 滚动播种
    expect(lobbyOf(c.state).queuePosition).toBe(1);
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    expect(rec!.status).toBe("running");
    expect(rec!.queue).toEqual([c.token]); // 旧队列空（q 已剪）、旧座位成员不携带
    await rejects(h.svc.getState(a.token, 0), "unknown-token"); // 旧座位成员 → 404（客户端自动重排）
});

test("rollover: token joining the ended world is carried into the next", async () => {
    const h = makeService();
    const a = await h.svc.join();
    for (let i = 0; i < 10; i++) {
        h.tick();
        await h.svc.getState(a.token, 0);
    }
    h.jump(250 * 20_000);
    const sa = consoleOf(await h.svc.getState(a.token, 999)); // a 推进：追赶至 250 → won
    expect(sa.view.end).toMatchObject({ kind: "won" });
    // 终局后加入 → join 见 ended 世界 → 滚动播种携 q（旧记录删除）。
    // （"仍在队的活跃 token 由自身轮询触发滚动"路径与 join 共用 spawn(carried, tok)；
    // 服务级确定性构造不可得——追赶期 AI 战争的尸体回池使任何排队者都可能被出生，
    // 2026-10-13 裁定以 join 路径覆盖滚动机制。）
    const q = await h.svc.join();
    const lq = lobbyOf(q.state);
    expect(lq.rolledOver).toBe(true);
    expect(lq.queuePosition).toBe(1);
    expect(lq.world.tick).toBe(1); // 新世界
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    expect(rec!.status).toBe("running");
    expect(rec!.queue).toEqual([q.token]);
    await rejects(h.svc.getState(a.token, 0), "unknown-token");
});

test("CAS failure self-heals: stale cache dropped, next op re-reads library version", async () => {
    // 锁过期竞态：他者在库内把记录推进到更高版本（idx 未及更新）。
    // 若本实例陈旧缓存不弃，其一切变更将永远 CAS 失败（世界对该实例砖化）——
    // 评审 Important #2 的深层后果；最小修复 = CAS 失败即弃缓存（评审 2026-10-14）。
    const h = makeService();
    const a = await h.svc.join();
    h.tick();
    const sa = consoleOf(await h.svc.getState(a.token, 0)); // 出生 + 推进（缓存最新）
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    const foreign = rec!.v + 1;
    rec!.v = foreign; // 模拟他者写入（仅版本推进，内容不变）
    expect(await h.store.writeRecord(idx!.worldId, rec!, foreign - 1)).toBe(true);
    // 陈旧缓存上的变更 → CAS 失败（版本冲突，非 OnlineError）
    let threw = false;
    try {
        await h.svc.submitAction(a.token, sa.timing.tick, 0, -1);
    } catch {
        threw = true;
    }
    expect(threw).toBe(true);
    // 自愈：缓存已弃 → 下一操作按库内版本重读 → CAS 成功
    const healed = await h.svc.submitAction(a.token, sa.timing.tick, 0, -1);
    expect(healed.kind).toBe("console");
});

test("persist warns when the record exceeds the size budget (monitoring floor)", async () => {
    // 计划的 64KB 记录体积目标须在生产写回路径有告警兜底（评审 Important #3）。
    // 预塞 200 个已关窗 × 36 提交条目（≈86KB > 64KB）——AI/死人席位的提交在重演
    // 中被防御性跳过，填充对确定性无害。
    const h = makeService();
    const a = await h.svc.join();
    h.tick();
    await h.svc.getState(a.token, 0); // 世界运行
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    const open = rec!.ticks.pop()!;
    for (let i = 0; i < 200; i++) {
        const nextActions: Record<string, [number, number]> = {};
        for (let s = 0; s < 36; s++) nextActions[String(s)] = [4, (s + 1) % 36];
        rec!.ticks.push({
            beganAtMs: 40_000 + i * 20_000,
            endedAtMs: 60_000 + i * 20_000,
            nextActions,
            rechoices: {},
        });
    }
    open.beganAtMs = 40_000 + 200 * 20_000;
    rec!.ticks.push(open);
    rec!.v += 1;
    expect(await h.store.writeRecord(idx!.worldId, rec!, rec!.v - 1)).toBe(true);
    dropCtx(idx!.worldId); // 模拟他实例视角：缓存过期，强制全量重读
    h.jump(500 * 20_000); // 过开窗截止 → 结算 → persist → 体积告警
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => warns.push(String(args[0]));
    try {
        await h.svc.getState(a.token, 999);
    } finally {
        console.warn = orig;
    }
    expect(warns.some((w) => w.includes("bytes"))).toBe(true);
});

test("rollover: queued token's own poll rolls the ended world over", async () => {
    // 评审建议 #3：getState 触发滚动的路径（此前台账裁定"确定性构造不可得"——
    // 库内直接改花名册即可确定性构造：ended 世界的"仍在队者"轮询）。
    const h = makeService();
    const a = await h.svc.join();
    for (let i = 0; i < 10; i++) {
        h.tick();
        await h.svc.getState(a.token, 0);
    }
    h.jump(250 * 20_000);
    consoleOf(await h.svc.getState(a.token, 999)); // a 推进 → 追赶到 250 → won
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    const q = "late-token";
    rec!.queue.push(q); // 直接花名册追加（ended 世界的排队者）
    rec!.joinedAt[q] = 250; // 加入时刻 = 已发生的出生数（否则重演幻影配对到早期席位）
    rec!.v += 1;
    expect(await h.store.writeRecord(idx!.worldId, rec!, rec!.v - 1)).toBe(true);
    dropCtx(idx!.worldId);
    const sq = lobbyOf(await h.svc.getState(q, 0)); // 排队者轮询 → 滚动
    expect(sq.rolledOver).toBe(true);
    expect(sq.queuePosition).toBe(1);
    expect(sq.world.tick).toBe(1); // 新世界
    const idx2 = await h.store.readIndex();
    const rec2 = await h.store.readRecord(idx2!.worldId);
    expect(rec2!.queue).toEqual([q]); // 携队且不重复
    expect(rec2!.status).toBe("running");
});

test("requeue after death: dead-seat join issues a fresh token and queues it", async () => {
    // 用户 2026-10-14：多次进出世界，每次都应重新排队。旧 bug：join 把死席当
    // "已在册"幂等 no-op → 返回的还是死亡遮罩 → 再排一次死循环。
    const h = makeService(INJECT_KNOWN);
    const a = await h.svc.join();
    const b = await h.svc.join();
    h.tick();
    h.tick();
    consoleOf(await h.svc.getState(a.token, 0)); // 两者出生；刻 3 飞行
    await h.svc.submitAction(a.token, 3, 6, 5); // a 入侵 b（刻 4 执行）
    h.tick();
    consoleOf(await h.svc.getState(b.token, 0)); // 刻 4 飞行，b 受害
    h.tick();
    const dead = consoleOf(await h.svc.getState(b.token, 0)); // 截止保原 → b 死
    expect(dead.view.end).toMatchObject({ kind: "dead", cause: "invade" });
    // 死席 join = 再排队：换发新 token + 队尾 lobby
    const rb = await h.svc.join(b.token);
    expect(rb.token).not.toBe(b.token);
    const lq = lobbyOf(rb.state);
    expect(lq.queuePosition).toBe(1);
    expect(lq.rolledOver).toBe(false);
    // 旧 token 的配对档案保留（重演安全）；其 getState 仍返回冻结死视图
    const idx = await h.store.readIndex();
    const rec = await h.store.readRecord(idx!.worldId);
    expect(rec!.seats[b.token]).toBe(5);
    const old = consoleOf(await h.svc.getState(b.token, 0));
    expect(old.view.end).toMatchObject({ kind: "dead", cause: "invade" });
    // 世界照常（a 存活）；新 token 为合法排队成员
    const sa = consoleOf(await h.svc.getState(a.token, 0));
    expect(sa.view.self).not.toBeNull();
});

test("sprint: last humans dead + empty queue → poll chains the world to end", async () => {
    const h = makeService(INJECT_KNOWN);
    const a = await h.svc.join();
    const b = await h.svc.join();
    h.tick();
    h.tick();
    consoleOf(await h.svc.getState(a.token, 0)); // 推进：两者出生；刻 3 飞行
    await h.svc.submitAction(a.token, 3, 6, 5);
    h.tick();
    consoleOf(await h.svc.getState(b.token, 0)); // 推进：刻 4 飞行，tok2 受害
    await h.svc.submitRechoice(b.token, 4, 6);
    h.tick();
    consoleOf(await h.svc.getState(a.token, 1)); // 推进：刻 4 结算 → 互毁——无存活人类、队列空
    h.jump(250 * 20_000);
    const sa = consoleOf(await h.svc.getState(a.token, 99));
    expect(sa.view.end).toMatchObject({ kind: "dead", cause: "mutual" }); // 冻结视图原样
    const rec = await h.store.readRecord((await h.store.readIndex())!.worldId);
    expect(rec!.status).toBe("ended"); // 冲刺至终局
});
