import { expect, test } from "bun:test";

import { V25_CONFIG } from "@/lib/engine/config";
import { ScriptedRng } from "@/lib/engine/rng";
import type { EndView } from "./match";
import { SoloMatch as Match } from "./match";
import { ViewTracker } from "./view";

/**
 * 场景编排说明：makeEnv 式基础队列（72 pos 全 0.02 同点、techs [1,2,3,4]、res 全 10、
 * 预滚 12.5）经 envRng 注入；fill=0.01 → 探测全触发（p ≥ 0.03·√1 = 0.03 > 0.01）。
 * presetRng 队列按时刻排列（random 预设：每活席一次 choice，目标二选再一次 choice）。
 */
function baseEnvRng(fill = 0.01) {
    return new ScriptedRng(
        [...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5],
        fill,
    );
}

/** 到达刻注入：u=0 → arrival 1（玩家 = 首个内生出生——v2.5 到达制的退化点，旧测试口径） */
const ARR1 = () => new ScriptedRng([0.0], 0);

test("start: queued ghost tick until player birth (arrival 1 = first endogenous birth), then awaiting-action", () => {
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(), envRng: baseEnvRng() });
    expect(m.phase).toBe("queued");
    m.start();
    expect(m.playerSlot).toBe(4);
    expect(m.env.alive[4]).toBe(1);
    expect(m.phase).toBe("awaiting-action");
    expect(m.env.t).toBe(1);
});

test("submitAction guards: wrong phase / invalid action / after end all throw", () => {
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(), envRng: baseEnvRng() });
    m.start();
    expect(() => m.submitRechoice(0)).toThrow(/phase/); // awaiting-action 下不可重选
    expect(() => m.submitAction(4, -1)).toThrow(/invalid/); // tech≈2.5 无已知 → STRIKE 非法
    const t0 = m.env.t;
    m.submitAction(0, -1); // SILENT
    expect(m.env.t).toBe(t0 + 1);
    // 强制终局（env 公开为测试接缝）
    const m2 = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(), envRng: baseEnvRng() });
    m2.env.alive.fill(0);
    m2.env.pending_spawns[0] = 9999;
    m2.start();
    expect(m2.phase).toBe("ended");
    expect(m2.getEnd()).toEqual({ kind: "unborn" });
    expect(() => m2.submitAction(0, -1)).toThrow(/ended/);
});

test("player invaded → awaiting-rechoice; counter-invade → mutual death (Q9)", () => {
    // presetRng 队列（random 预设：每活席一次 choice；目标二选再一次 choice）：
    // t0/t1 四席 DEVELOP（非静默——静默 ×0.25 截面会使全互探熄火）；t2 五席（slot5 于 t1 内生出生）
    // slot0=INVADE、余 SILENT，目标二选弹 4=玩家。玩家 t1 出生、探测刻中结算 → t2 才可被入侵。
    const presetRng = new ScriptedRng(
        [1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4],
        0.5,
    );
    const m = new Match(7, ["random"], new Map(), V25_CONFIG, { arrivalRng: ARR1(), envRng: baseEnvRng(), presetRng });
    m.start(); // t0：出生 slot4
    m.submitAction(1, -1); // t1：DEVELOP（非静默，slot0 刻中探测到玩家）
    expect(m.phase).toBe("awaiting-action");
    m.submitAction(1, -1); // t2：slot0 入侵玩家
    expect(m.phase).toBe("awaiting-rechoice");
    expect(m.getPendingInvader()).toBe(0);
    m.submitRechoice(6); // 反咬——无显式目标也生效
    expect(m.phase).toBe("ended");
    const end = m.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("mutual");
    expect(end.kills).toBe(0);
    expect(end.loot).toBe(0);
});

test("re-choose BD cancels the invasion; cancel keeps the original action", () => {
    const mk = () =>
        new Match(7, ["random"], new Map(), V25_CONFIG, { arrivalRng: ARR1(),
            envRng: baseEnvRng(),
            presetRng: new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4], 0.5),
        });
    // 黑域取消：玩家 BD 须合法（tech>5）——出生科技 1.0（v2.4 无继承——恒 techSpawnLo），经 env 接缝上调
    const m1 = mk();
    m1.start();
    m1.env.tech[4] = 6;
    m1.submitAction(1, -1);
    m1.submitAction(1, -1);
    expect(m1.phase).toBe("awaiting-rechoice");
    expect(() => m1.submitRechoice(5)).not.toThrow(); // tech=6 → BD 合法
    expect(m1.env.alive[4]).toBe(1);
    expect(m1.env.domain_windup[4]).toBe(1); // 入场风窗（入侵被取消）
    expect(m1.phase).toBe("awaiting-action");
    // 取消 = 保持原动作：入侵照常结算 → 玩家死于 invade
    const m2 = mk();
    m2.start();
    m2.submitAction(1, -1);
    m2.submitAction(1, -1);
    expect(m2.phase).toBe("awaiting-rechoice");
    m2.submitRechoice(0); // 保持 SILENT（t2 的原动作改为静默即可被入侵击杀）
    const end = m2.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("invade");
});

test("won: alive at t_max", () => {
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(), envRng: baseEnvRng() });
    m.start();
    m.env.t = V25_CONFIG.tMax - 2; // 接缝：直接推到末两刻
    m.submitAction(0, -1);
    m.submitAction(0, -1);
    expect(m.phase).toBe("ended");
    const end = m.getEnd() as Extract<EndView, { kind: "won" }>;
    expect(end.kind).toBe("won");
    expect(end.nAlive).toBeGreaterThan(0);
    expect(m.getEnd()!.kind).toBe("won");
});

test("stats: own strike kill + invade loot accumulate from info (rule ①)", () => {
    // fill=0.025：探测火（< p_row≈0.03+）而流失不触发（≥0.02）——res 保持 10，loot 恰 5。
    // presetRng fill=0.3：pacifist 恒 DEVELOP（非静默 → 玩家可探测到全部 AI）。
    // 玩家经接缝上调 tech=9 → STRIKE/INVADE 合法。
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(),
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    m.start();
    m.env.tech[4] = 9;
    m.submitAction(1, -1); // t1：刻中玩家探测到 1,2,3 → known[4,*]
    expect(m.env.known[4 * 36 + 1]).toBe(1);
    m.submitAction(4, 1); // t2：STRIKE slot1（p=0.95 > 掷骰 0.025）
    expect(m.env.death_cause[1]).toBe("strike");
    expect(m.stats().kills).toBe(1);
    expect(m.stats().loot).toBe(0);
    m.submitAction(6, 2); // t3：INVADE slot2 → loot = 0.5×10
    expect(m.stats().loot).toBe(5);
    expect(m.stats().kills).toBe(2);
    expect(m.env.alive[2]).toBe(0);
});

test("v2.4: cfg injection — custom tMax ends the run at 20 (won, not 250)", () => {
    const m = new Match(7, ["pacifist"], new Map(), { ...V25_CONFIG, tMax: 20 }, { arrivalRng: ARR1(), envRng: baseEnvRng() });
    m.start();
    for (let i = 0; i < 30 && m.phase !== "ended"; i++) m.submitAction(0, -1);
    expect(m.phase).toBe("ended");
    expect(m.env.t).toBe(20);
    expect(m.getEnd()!.kind).toBe("won");
});

test("v2.4: submitAction guards BOTHER target (reveal needs explicit candidate)", () => {
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(),
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    m.start();
    m.env.tech[4] = 6; // 广播门（tech>1）
    m.submitAction(1, -1); // 刻中探测 → known[4, 1..3]
    expect(() => m.submitAction(3, -1)).toThrow(/reveal/); // 揭露无兜底：必须显式目标
    expect(() => m.submitAction(3, 1)).not.toThrow(); // 合法候选 → 揭露入队
    expect(m.env.pending_reveal.some((e) => e[0] === "other" && e[1] === 1)).toBe(true);
    m.submitAction(0, -1); // 结算：slot1 全场公开
    expect(m.env.public_[1]).toBe(1);
    expect(m.env.public_[4]).toBe(0); // 发送者不暴露
});

test("v2.4: OBSERVE takes explicit target; -1 falls back to nearest known", () => {
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, { arrivalRng: ARR1(),
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    m.start();
    m.env.tech[4] = 6; // OBSERVE 门 tech>5
    m.submitAction(1, -1);
    m.submitAction(7, 2); // 显式观测 slot2
    expect(m.env.observed[4 * 36 + 2]).toBe(1);
    m.submitAction(7, -1); // 无目标 → 最近已知（全同点平手取先 = slot0——探测亦发现 0）
    expect(m.env.observed[4 * 36 + 0]).toBe(1);
});

// ------------------------------------------------------- v2.5 随机到达出生（用户 2026-11-01）

test("arrival: u=0.5 → arrival 126 — earlier births go to opponents, player takes tick-126 birth", () => {
    // QUIET（0.05）：无流失/爆炸/饿死 → 每刻恰一出生（预滚队列尽后恒 fill 0.05）。
    // 槽公式：tick k 的出生槽 = k+3（初始 4 席后顺延；33/69 刻的 _grow 不破坏——
    // 每次翻倍恰补足后续未生槽）。到达前的 125 次出生全归对手光标。
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, {
        envRng: baseEnvRng(0.05),
        presetRng: new ScriptedRng([], 0.3),
        arrivalRng: new ScriptedRng([0.5], 0),
    });
    let queuedTicks = 0;
    m.start(() => queuedTicks++);
    expect(m.arrivalTick).toBe(126);
    // 槽公式：tick k ≤ 32 → k+3；t33 增长（36→72，出生取 n-1=71）；34..68 → k+2；
    // t69 二次增长（72→144，取 143）；k ≥ 70 → k+2。tick 126 → 128
    expect(m.playerSlot).toBe(128);
    expect(m.env.spawn_tick[128]).toBe(126);
    expect(m.phase).toBe("awaiting-action");
    expect(m.env.t).toBe(126);
    expect(queuedTicks).toBe(126); // 逐刻回调（含出生刻——ViewTracker 契约）
});

test("arrival: u=0 → arrival 1 — player takes the first endogenous birth (legacy behavior)", () => {
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, {
        envRng: baseEnvRng(),
        presetRng: new ScriptedRng([], 0.3),
        arrivalRng: new ScriptedRng([0.0], 0),
    });
    m.start();
    expect(m.arrivalTick).toBe(1);
    expect(m.playerSlot).toBe(4); // 首个内生出生（旧 PLAYER_BIRTH_ORDINAL 行为）
});

test("grow-slot birth: reward/loot consumers length-guard old-n resolve arrays (review I-1)", () => {
    // 面板可调大预算（1000）→ 36 槽满员存活 → t33 _grow；arrival=33 恰落增长刻 →
    // 玩家生于扩容槽 71（new_n−1）。resolve 返回的 rewards/loot_to/rewardDetail 数组
    // 长度 = 扩容前 n（python 同构——ctx 在 resolve 入口按旧 n 分配）——会话/视图层
    // 直索引 OOB → NaN 一次注入永久污染（评审 I-1 实证）。守卫后：出生刻读数为
    // 有限（0），此后正常累计。
    const m = new Match(7, ["pacifist"], new Map(), { ...V25_CONFIG, resTotalBudget: 1000 }, {
        envRng: baseEnvRng(0.05),
        presetRng: new ScriptedRng([], 0.3),
        arrivalRng: new ScriptedRng([0.128], 0), // arrival = 1 + floor(0.128·250) = 33
    });
    const tr = new ViewTracker(m);
    m.start(() => tr.update());
    expect(m.playerSlot).toBe(71); // 增长刻出生（new_n−1 = 71）
    const v1 = tr.update();
    expect(Number.isFinite(v1.reward!.total)).toBe(true); // 出生刻奖励有限（未注入 NaN）
    expect(m.stats().loot).toBe(0); // NaN 污染会使此后一切读数变 NaN
    m.submitAction(1, -1); // t34：DEVELOP（数组已按 n=72 分配——正常路径）
    const v2 = tr.update();
    expect(Number.isFinite(v2.reward!.total)).toBe(true);
    expect(v2.reward!.total).toBeGreaterThan(0); // softsign 津贴正常累计
});

test("same-tick recycle of the player's slot must still end the game (died_this_tick, not env.alive)", () => {
    // 走查回归（2026-11-04）：solo 判死原用 !env.alive[playerSlot]——v2.5 同刻复用为
    // 缺省后，玩家死亡的同一刻其槽位即被复用（死者=最小死槽）→ alive=1（新 AI 住客）
    // → 死亡漏检、游戏不结束、玩家无缝操控新住客（"重生"）。修复：判死走
    // died_this_tick 事件流（对复用时序免疫——同在线 processDeaths 的口径）。
    const mk = () =>
        new Match(7, ["random"], new Map(), V25_CONFIG, {
            arrivalRng: ARR1(),
            envRng: baseEnvRng(),
            presetRng: new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4], 0.5),
        });
    const m = mk();
    m.start();
    m.submitAction(1, -1); // t1：DEVELOP（刻中探测）
    m.submitAction(1, -1); // t2：slot0 入侵玩家
    expect(m.phase).toBe("awaiting-rechoice");
    // 接缝：耗尽未生槽 + 池够——玩家死亡的同刻其槽位即被复用（三级出生第 2 级）
    for (let i = 5; i < 36; i++) {
        m.env.spawn_tick[i] = 1;
        m.env.alive[i] = 1;
    }
    m.env.free_pool = 20;
    m.env.pending_spawns[0] = 12.5;
    m.submitRechoice(0); // 保持原动作（SILENT）→ 死于入侵
    // 同刻复用确实发生（新住客在场——alive 判死此时读到 1，正是漏检根源）
    expect(m.env.alive[4]).toBe(1);
    // 死亡仍须被检出：游戏结束（修复前 = awaiting-action + getEnd() null 的"无缝重生"）
    expect(m.phase).toBe("ended");
    const end = m.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("unknown"); // Q19：同刻复用在事件流装配前清死因 → unknown 兜底
    expect(end.ticks).toBe(2); // 入席快照：死亡刻 env.t=3 − 入席 t=1（复用覆写免疫）
});

test("birth via same-tick slot reuse must not consume the previous occupant's death (no tick-0 false death)", () => {
    // 走查回归（2026-11-06 "饿死在第 0 刻"）：到达出生可能同刻复用刚死的槽位——
    // 死亡阶段（4-8）先于出生阶段（10），该槽位的 died_this_tick 条目属于**前任
    // 住客**（复用清死因 → ""，Q19）。判死先于 assignBirths 时新生玩家才会吃到
    // 前任的死亡条目 → 进入即死（ticks 0、资源条显示新生儿的 U[5,20]）。在线侧
    // driver.ts 本就"先判死后入席"（:314）——solo 对齐同一顺序。
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, {
        envRng: baseEnvRng(),
        presetRng: new ScriptedRng([], 0.3),
        arrivalRng: new ScriptedRng([0.01], 0), // arrival = 1 + floor(0.01·250) = 3
    });
    const tr = new ViewTracker(m);
    let prepped = false;
    m.start(() => {
        // 接缝（tick 1 结算后、tick 2 结算前）：耗尽未生槽 + 饿死 slot1 + 池够——
        // tick 2 的出生走复用（最小死槽 = slot1），恰为玩家的到达出生
        if (!prepped && m.env.t === 2) {
            prepped = true;
            for (let i = 4; i < 36; i++) {
                m.env.spawn_tick[i] = 1;
                m.env.alive[i] = 1;
                m.env.res[i] = 10; // 伪在场槽不饿死
            }
            m.env.res[1] = 0; // slot1 于 tick 2 饿死
            m.env.free_pool = 20;
            m.env.pending_spawns[0] = 12.5;
        }
    });
    // 场景自证：玩家 = 复用槽 1 的到达出生；该槽在本刻 died_this_tick 里
    //（条目 [1,""] 属于前任住客——Q19 复用清死因），新生儿在场且资源有余
    expect(m.playerSlot).toBe(1);
    expect(m.lastResult!.info.died_this_tick).toContainEqual([1, ""]);
    expect(m.env.alive[1]).toBe(1);
    expect(m.env.res[1]).toBeGreaterThan(0);
    // 修复目标：假死亡不得发生——游戏继续、终局为空、日志无死亡行
    expect(m.phase).toBe("awaiting-action");
    expect(m.getEnd()).toBeNull();
    const v = tr.update();
    expect(v.log.some((e) => e.key === "log.death")).toBe(false);
    expect(v.log.some((e) => e.key === "match.birthSelf")).toBe(true); // 出生照常记录
});

test("genuine starvation: overlay and log both report starve; res bar reads zero (walkthrough 2026-11-06)", () => {
    // 用户验收标准：资源耗尽而死时，死亡弹窗与日志行均显示饿死，且资源条实际归零。
    // （EndView.cause = 弹窗数据源；log.death params.cause = 日志数据源——无同刻
    // 复用时死因不经 Q19 清除，两端一致。）
    const m = new Match(7, ["pacifist"], new Map(), V25_CONFIG, {
        envRng: baseEnvRng(),
        presetRng: new ScriptedRng([], 0.3),
        arrivalRng: ARR1(),
    });
    const tr = new ViewTracker(m);
    tr.update(); // 排队态（client.ts 同构装配）
    m.start(() => tr.update());
    expect(m.playerSlot).toBe(4);
    m.env.res[4] = 0; // 接缝：资源耗尽
    m.submitAction(0, -1); // SILENT——阶段 8 饿死（无复用：出生走未生槽）
    const v = tr.update();
    const end = m.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("starve"); // 弹窗死因 = 饿死
    expect(m.env.res[4]).toBe(0); // 资源条归零（尸体结算置 0）
    expect(v.self!.res).toBe(0); // 视图读数同源归零
    const death = v.log.find((e) => e.key === "log.death");
    expect(death).toBeDefined();
    expect(death!.params!.cause).toBe("cause.starve"); // 日志死因 = 饿死（与弹窗一致）
    expect(death!.params!.ticks).toBe(end.ticks);
});

test("arrival: world ends before arrival → unborn ending", () => {
    const m = new Match(7, ["pacifist"], new Map(), { ...V25_CONFIG, tMax: 6 }, {
        envRng: baseEnvRng(),
        presetRng: new ScriptedRng([], 0.3),
        arrivalRng: new ScriptedRng([0.999], 0), // arrival = 1 + floor(0.999·6) = 6
    });
    m.env.pending_spawns[0] = 9999; // 抑制全部出生 → 空转到 t_max
    m.start();
    expect(m.getEnd()).toEqual({ kind: "unborn" });
    expect(m.phase).toBe("ended");
});

test("rechoice widened: any action accepted (valid-gated) — non-5/6 no longer rejected", () => {
    // 用户 2026-11-01（动作格反咬项）：重选 = 任意动作 ∪ 反咬。DEVELOP(1) 重选合法
    //（无门）——受害者仍死于入侵（非 5/6 重选不改变入侵结局）；invasion 视图携带
    // 本刻原动作（重选提示的"保持原动作"数据源）。
    const mk = () =>
        new Match(7, ["random"], new Map(), V25_CONFIG, { arrivalRng: ARR1(),
            envRng: baseEnvRng(),
            presetRng: new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4], 0.5),
        });
    const m = mk();
    m.start();
    m.submitAction(1, -1); // t1：DEVELOP（刻中探测）
    m.submitAction(1, -1); // t2：slot0 入侵玩家
    expect(m.phase).toBe("awaiting-rechoice");
    const tr = new ViewTracker(m);
    const v = tr.update();
    expect(v.invasion).toEqual({ invaderId: 0, originalAction: 1 }); // 原动作 = 上窗提交的 DEVELOP
    expect(() => m.submitRechoice(1)).not.toThrow(); // 旧实现：非 5/6 即拒
    const end = m.getEnd() as Extract<EndView, { kind: "dead" }>;
    expect(end.kind).toBe("dead");
    expect(end.cause).toBe("invade"); // 重选 DEVELOP 不救
});
