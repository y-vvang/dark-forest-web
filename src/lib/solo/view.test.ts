import { expect, test } from "bun:test";

import { ScriptedRng } from "@/lib/engine/rng";
import { V24_CONFIG } from "@/lib/engine/config";
import { ViewTracker } from "./view";
import { SoloMatch } from "./match";

/** 与 match.test 同款基础队列（72 pos 同点、techs [1,2,3,4]、res 全 10、预滚 12.5） */
function baseEnvRng(fill = 0.01) {
    return new ScriptedRng(
        [...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5],
        fill,
    );
}

test("queued → waitBirth; birth → birthSelf; self marker appears (rules ②⑤⑥)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, { envRng: baseEnvRng() });
    const tr = new ViewTracker(m);
    const v0 = tr.update();
    expect(v0.phase).toBe("queued");
    expect(tr.getLog().map((e) => e.key)).toEqual(["match.waitBirth"]);
    expect(v0.self).toBe(null);
    expect(v0.markers).toEqual([{ id: -1, x: 50, y: 50, state: "queued" }]);
    m.start();
    const v1 = tr.update();
    expect(v1.phase).toBe("awaiting-action");
    expect(tr.getLog().map((e) => e.key)).toEqual(["match.waitBirth", "match.birthSelf"]);
    expect(v1.self).not.toBe(null);
    expect(v1.markers[0].state).toBe("self");
    expect(v1.self!.tech).toBeGreaterThan(0);
});

test("AI-vs-AI strike invisible; own detection produces contacts (rules ⑦③)", () => {
    // 高科技 df 对手互相残杀；玩家（tech 1.0）静默——该刻无交锋日志（仅⑩的出生条目），nAlive 下降可见
    // fill=0.05：玩家截面 0.03·√1=0.03 < 0.05（v2.4 出生科技 1.0——保持玩家零感知），
    // AI 互探 0.03·√9=0.09 > 0.05 照常（t1 互杀前提成立）
    const envRng = new ScriptedRng(
        [...Array(72).fill(0.02), 9, 9, 9, 9, 10, 10, 10, 10, 12.5],
        0.05,
    );
    const m = new SoloMatch(7, ["df"], new Map(), V24_CONFIG, { envRng });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    tr.update();
    const logLen = tr.getLog().length;
    const aliveBefore = tr.update().nAlive;
    m.submitAction(0, -1); // t1：df 们同刻互杀 + 内生出生 slot5
    const v = tr.update();
    expect(v.nAlive).toBeLessThan(aliveBefore); // 全局读数可见（世界 HUD）
    const newEntries = tr.getLog().slice(logLen);
    // v2.4 出生科技 1.0 → 玩家探测截面 0.03 > fill 0.01：contact（规则③）合法发生；
    // 本测试锁定的是规则⑦：AI 互杀刻【无任何交锋条目】（ownStrike/dark 皆零）
    expect(newEntries.some((e) => e.key === "log.born")).toBe(true);
    expect(newEntries.filter((e) => e.key.startsWith("log.ownStrike") || e.key === "log.dark")).toEqual([]);
    expect(tr.getLog().some((e) => e.key === "log.dark")).toBe(false); // 玩家一无所知
    expect(v.markers.filter((x) => x.state !== "self")).toEqual([]);
});

test("player detect → contact entries + known markers; observe fills intel (rules ③①)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3), // pacifist 恒 DEVELOP（非静默可被探测）
    });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.tech[4] = 9;
    tr.update();
    m.submitAction(1, -1); // t1：玩家探测到 1,2,3 与内生出生的 5（全非静默、0.025 < p）
    const v = tr.update();
    const entries = tr.getLog().slice(-4).filter((e) => e.key === "log.contact");
    expect(entries).toHaveLength(4);
    expect(entries[0].params).toEqual({ x: "0", y: "0" }); // 0.02 → 整数坐标
    expect(v.markers.filter((x) => x.state === "known")).toHaveLength(4);
    // t2：OBSERVE → 最近已知（全同点平手取先 = slot 0）获精确情报
    m.submitAction(7, -1);
    tr.update();
    const obs = tr.getLog().filter((e) => e.key === "log.observed");
    expect(obs).toHaveLength(1);
    expect(obs[0].params).toEqual({ id: 0, tech: "1.1", res: "10.0" }); // slot0：tech 1 + 两刻发展
    const m0 = tr.update().markers.find((x) => x.id === 0);
    expect(m0?.state).toBe("observed");
    expect(m0?.res).toBe(10);
});

test("own strike hit / broadcast flow (rules ①④)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.tech[4] = 9;
    tr.update();
    m.submitAction(1, -1); // t1：探测
    tr.update();
    m.submitAction(4, 1); // t2：STRIKE slot1（p=0.95 > 0.025）→ ownStrikeHit
    tr.update();
    expect(tr.getLog().some((e) => e.key === "log.ownStrikeHit" && e.params?.id === 1)).toBe(true);
    m.submitAction(2, -1); // t3：BROADCAST
    tr.update();
    expect(tr.getLog().some((e) => e.key === "log.ownBroadcast")).toBe(true);
    // 下刻：自我状态可见（public 化经 known[all,4] 生效，自身标记不因公开降级——self 优先）
    m.submitAction(1, -1);
    const v = tr.update();
    expect(v.markers[0]).toMatchObject({ state: "self" });
    expect(v.self).not.toBe(null);
});

test("known civ dies → dark entry, marker vanishes (rule ⑥)", () => {
    const envRng = new ScriptedRng(
        [...Array(72).fill(0.02), 9, 1, 9, 1, 10, 10, 10, 10, 12.5],
        0.025,
    );
    // random 对手：t0/t1 全 DEVELOP（非静默），t2 五席（slot5 于 t1 出生）——slot0 STRIKE 目标 slot1
    const presetRng = new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 0, 0, 1], 0.5);
    const m = new SoloMatch(7, ["random"], new Map(), V24_CONFIG, { envRng, presetRng });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.tech[4] = 9;
    tr.update();
    m.submitAction(1, -1); // t1：玩家探测到 1,2,3（全非静默；5 于本刻出生，t2 才可探测）
    tr.update();
    const v1 = tr.update();
    expect(v1.markers.some((x) => x.id === 1 && x.state === "known")).toBe(true);
    m.submitAction(1, -1); // t2：slot0 打死 slot1
    const v2 = tr.update();
    expect(tr.getLog().slice(-1)[0].key).toBe("log.dark"); // 已知信号消失（无死因）
    expect(v2.markers.find((x) => x.id === 1)).toBeUndefined();
});

test("invasion notice: view.invasion + log.invaded (rule ②)", () => {
    const presetRng = new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 4], 0.5);
    const m = new SoloMatch(7, ["random"], new Map(), V24_CONFIG, { envRng: baseEnvRng(), presetRng });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    tr.update();
    m.submitAction(1, -1);
    tr.update();
    m.submitAction(1, -1); // t2：slot0 入侵玩家
    const v = tr.update();
    expect(m.phase).toBe("awaiting-rechoice");
    expect(v.invasion).toEqual({ invaderId: 0 });
    expect(tr.getLog().slice(-1)[0]).toMatchObject({ key: "log.invaded", params: { id: 0 } });
    m.submitRechoice(6); // 反咬 → 死亡：log.death + end
    const v2 = tr.update();
    const death = tr.getLog().filter((e) => e.key === "log.death");
    expect(death).toHaveLength(1);
    expect(death[0].params?.ticks).toBe(2);
    expect(death[0].params?.cause).toBe("cause.mutual"); // 键嵌套翻译由 EventLog 做
    expect(v2.end).toMatchObject({ kind: "dead", cause: "mutual" });
});

test("birth of others is intel-free (rule ⑩)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, { envRng: baseEnvRng() });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    tr.update();
    const len = tr.getLog().length;
    m.submitAction(1, -1); // 池攒钱 → t1 内生出生 slot5（玩家不知其存在）
    tr.update();
    const born = tr.getLog().slice(len).filter((e) => e.key === "log.born");
    expect(born).toHaveLength(1);
    expect(born[0].params).toBeUndefined(); // 情报-free：无 id/资源
    expect(tr.update().nAlive).toBe(6);
});

test("update() hands out a FRESH log array each call (React element-identity bailout)", () => {
    // 用户手测回归（2026-10-08）：日志冻结在出生消息——React Compiler 缓存元素，
    // events 引用恒等 → EventLog 子树永不重渲染。契约：每次 update 必须返回新数组。
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, { envRng: baseEnvRng() });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    const v1 = tr.update();
    m.submitAction(1, -1); // t1：内生出生 → log.born
    const v2 = tr.update();
    expect(v2.log.length).toBeGreaterThan(v1.log.length); // 事件确实积累了
    expect(v2.log).not.toBe(v1.log); // 但数组引用必须不同，否则 memo 化组件拿不到新内容
});

test("log.contact emits SELF-RELATIVE torus deltas matching the centered chart (review I1)", () => {
    // 相机居中后星图 = 自身相对坐标；日志绝对坐标会与星图失联（玩家不知自己的世界坐标）。
    // 契约：contact 的 (x,y) = wrapDelta(civ − self)，带符号整数，与星图同构。
    // slot1 移到 (12,92)——自身在 (0.02,0.02) → 环面差 (+12,−8)，距离 ≈14.4 ≤ 30 可探测。
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3), // pacifist 恒 DEVELOP（非静默可被探测）
    });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.tech[4] = 9; // 探测概率 0.09 > 0.025
    m.env.pos[1 * 2] = 12;
    m.env.pos[1 * 2 + 1] = 92;
    m.submitAction(1, -1); // t1：探测
    tr.update();
    const contacts = tr.getLog().filter((e) => e.key === "log.contact");
    expect(
        contacts.some((e) => e.params?.x === "+12" && e.params?.y === "-8"),
    ).toBe(true); // 相对坐标（原绝对坐标为 12/92——本用例即为其回归锁）
    expect(contacts.some((e) => e.params?.x === "0" && e.params?.y === "0")).toBe(true); // 同点者 (0,0)
});

test("domain marker intel is FROZEN at the windup tick end (review Important 1)", () => {
    // env2.py:313 的 known_pair 只滤 ~in_domain 不滤 windup——观测情报喂到【声明刻末】，
    // 域生效刻起才掩蔽 → 快照点 = 风窗刻末 = 玩家收到 live 情报的最后时刻（精确，非近似）。
    // 场景：t0 幽灵刻 → t1 玩家探测全员 → t2 OBSERVE slot0 → t3 slot0 声明黑域 → t4 域内发展×0.2
    const presetRng = new ScriptedRng(
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 1, 1, 1, 1, 1, 1, 1], // t0..t4 各 4 席（出生已抑制）
        0.5,
    );
    const m = new SoloMatch(7, ["random"], new Map(), V24_CONFIG, { envRng: baseEnvRng(0.025), presetRng });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.pending_spawns[0] = 9999; // 抑制内生出生：AI 席位恒 4
    m.env.tech[4] = 9; // 玩家 OBSERVE 门
    m.env.tech[0] = 6; // slot0 的 BD 门（基础 1 → 上调）
    m.submitAction(1, -1); // t1：玩家探测 0-3
    tr.update();
    m.submitAction(7, -1); // t2：OBSERVE → 最近已知平手取先 = slot0
    tr.update();
    expect(tr.update().markers.find((x) => x.id === 0)?.state).toBe("observed");
    m.submitAction(1, -1); // t3：slot0 声明黑域 → 风窗；processTick 刻末快照
    const techAtSeal = tr.update().markers.find((x) => x.id === 0)?.tech; // live 情报的最后时刻值
    expect(techAtSeal).toBeDefined();
    m.submitAction(1, -1); // t4：域生效；slot0 域内发展 ×0.2 → env.tech[0] 前进
    const v4 = tr.update();
    const marker = v4.markers.find((x) => x.id === 0);
    expect(marker?.state).toBe("domain");
    expect(marker?.tech).toBe(techAtSeal); // 冻结：恰等于封存刻末值
    expect(m.env.tech[0]).toBeGreaterThan(marker?.tech ?? 0); // env 已前进——证明非活值
    expect(marker?.res).toBe(10); // 无流失（fill 0.025 ≥ p 0.02）：封存资源保持
});

test("v2.4 own reveal: log.ownReveal with target id; target public next tick (rule ①)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.tech[4] = 6; // 广播门
    tr.update();
    m.submitAction(1, -1); // t1：探测
    tr.update();
    m.submitAction(3, 1); // t2：揭露 slot1 → ownReveal
    tr.update();
    expect(tr.getLog().some((e) => e.key === "log.ownReveal" && e.params?.id === 1)).toBe(true);
    m.submitAction(1, -1); // t3：揭露结算
    const v = tr.update();
    expect(m.env.public_[1]).toBe(1);
    expect(m.env.public_[4]).toBe(0); // 发送者不暴露
    expect(v.markers.find((x) => x.id === 1)?.state).toBe("public"); // 他人揭露的 public 化可见
});

test("v2.4 rule ⑫: being revealed is INVISIBLE — no log entry of any kind", () => {
    // slot1（tech 2）t1 探测到玩家 → t2 揭露玩家 → t3 结算：玩家无任何感知条目
    const presetRng = new ScriptedRng(
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 4],
        0.5,
    );
    const m = new SoloMatch(7, ["random"], new Map(), V24_CONFIG, { envRng: baseEnvRng(0.025), presetRng });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.pending_spawns[0] = 9999; // 抑制出生：AI 席恒 4
    tr.update();
    m.submitAction(1, -1); // t1：玩家 DEVELOP（非静默）→ slot1 探测到玩家
    tr.update();
    expect(m.env.known[1 * 36 + 4]).toBe(1); // 前置：slot1 确已知晓玩家
    const len = tr.getLog().length;
    m.submitAction(0, -1); // t2：slot1 BOTHER（脚本 3）目标玩家（脚本 4）
    tr.update();
    const entries = tr.getLog().slice(len).map((e) => e.key);
    expect(entries).toEqual([]); // ⑫：被揭露零感知（无 contact/broadcast/invaded）
    m.submitAction(0, -1); // t3：揭露结算（public[4]=1，known[all,4]）
    const entries2 = tr.getLog().slice(len).map((e) => e.key);
    tr.update();
    expect(m.env.public_[4]).toBe(1);
    expect(entries2).toEqual([]); // 结算刻同样零感知
});

test("v2.4 third-party reveal looks like a self-broadcast to the player (deception)", () => {
    // slot1 揭露【玩家尚不知的】slot3：揭露把 known[all alive, 3] 连同玩家行一并点亮 +
    // public[3] → 玩家视角与「slot3 自曝」完全同形（规则④路径）——机制即欺骗：
    // 借刀杀人不可归因。slot3 移远使玩家探测不到它（揭露前）；slot1 经接缝知晓它。
    const presetRng = new ScriptedRng(
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 3],
        0.5,
    );
    const m = new SoloMatch(7, ["random"], new Map(), V24_CONFIG, { envRng: baseEnvRng(0.025), presetRng });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.pending_spawns[0] = 9999; // 抑制出生：AI 席恒 4
    m.env.tech[4] = 6; // 玩家探测 p=0.073 > 0.025（探到近处的 0,1,2；远处的 3 探不到）
    m.env.pos[3 * 2] = 60; // 环面距离 √(40²+40²)≈56.6 > 30：玩家探测不到（揭露前）
    m.env.pos[3 * 2 + 1] = 60;
    m.env.known[1 * 36 + 3] = 1; // 接缝：slot1 知晓远处的 slot3（BOTHER 不限距离）
    tr.update();
    m.submitAction(1, -1); // t1：玩家探测 0,1,2（slot3 远——不触发 contact）
    tr.update();
    const len = tr.getLog().length;
    m.submitAction(1, -1); // t2：slot1 BOTHER 目标 slot3（脚本 3）
    tr.update();
    m.submitAction(1, -1); // t3：揭露结算
    const v = tr.update();
    expect(m.env.public_[3]).toBe(1);
    expect(v.markers.find((x) => x.id === 3)?.state).toBe("public");
    expect(
        tr.getLog().slice(len).some((e) => e.key === "log.broadcast" && e.params?.id === 3),
    ).toBe(true); // 归因歧义 = 机制真相（规则④路径）
});

test("v2.4 reward view: configured stream + four-arm comparison (user 2026-10-10)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    const tr = new ViewTracker(m);
    tr.update();
    expect(tr.update().reward).toBe(null); // 未生 → null
    m.start();
    m.env.tech[4] = 6;
    tr.update();
    m.submitAction(1, -1); // t1：DEVELOP
    const v = tr.update();
    const r = v.reward!;
    expect(r.total).toBeGreaterThan(0); // 默认（=a 臂）softsign 津贴
    expect(r.parts.stipend).toBeCloseTo(r.total, 12);
    expect(r.arms.map((a) => a.id)).toEqual(["a_classic", "b_terminal", "c_res", "d_malintent"]);
    const byId = Object.fromEntries(r.arms.map((a) => [a.id, a.total]));
    expect(byId.a_classic).toBeCloseTo(r.total, 12); // 默认配置 = a 臂参数
    expect(byId.b_terminal).toBe(0); // soft 0：无死亡无津贴
    expect(byId.c_res).toBeCloseTo(r.total + 0.0025 * 12.5, 12); // +res 津贴（出生 res=预滚 12.5，无流失）
    expect(byId.d_malintent).toBeCloseTo(byId.c_res, 12); // 无攻击：d = c
    expect(r.lastTick).toBeCloseTo(r.total, 12); // 单刻累计
    // 死亡罚：互毁刻 → 全臂 −10，b 臂跳负
    m.env.known[4 * 36 + 1] = 1;
    m.submitAction(6, 1); // t2：玩家入侵 slot1……（无反咬——pacifist）
    tr.update();
    const r2 = tr.update().reward!;
    expect(r2.total).toBeCloseTo(r.total + 0, 12); // 入侵缴获无默认赏金
    // 下一步黑域：bdEnter 分量
    m.submitAction(5, -1); // t3：声明黑域（tech 6>5）→ −0.5
    tr.update();
    const r3 = tr.update().reward!;
    expect(r3.parts.bdEntry).toBe(-0.5);
    expect(Object.fromEntries(r3.arms.map((a) => [a.id, a.total])).b_terminal).toBe(0); // b 臂 bd 罚为 0
});

test("v2.4 own reveal suppressed when the target's domain activates between lock and queue (stage-0→3 order)", () => {
    // 评审修复（review 2026-10-12 #2）：目标在锁定后、入队前（阶段 0 域激活）转入 in_domain →
    // 阶段 3 静默跳过揭露——view 不得发 ownReveal（感知忠实：宁可少知，不渲染未发生的事件）。
    const m = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    m.env.tech[4] = 6;
    m.env.pending_spawns[0] = 9999;
    tr.update();
    m.submitAction(1, -1); // t1：探测 slot1
    tr.update();
    m.env.domain_windup[1] = 1; // 接缝：slot1 已在风窗（selectTargets 不排风窗 → 锁定通过）
    const len = tr.getLog().length;
    m.submitAction(3, 1); // t2：揭露 slot1 → 阶段 0 域激活 → 阶段 3 !in_domain 拦下
    tr.update();
    expect(m.env.in_domain[1]).toBe(1);
    expect(m.env.pending_reveal.some((e) => e[0] === "other")).toBe(false); // 揭露确实未入队
    expect(tr.getLog().slice(len).some((e) => e.key === "log.ownReveal")).toBe(false); // 不得虚报
    // 对照组：目标未入域 → 正常 ownReveal
    const m2 = new SoloMatch(7, ["pacifist"], new Map(), V24_CONFIG, {
        envRng: baseEnvRng(0.025),
        presetRng: new ScriptedRng([], 0.3),
    });
    const tr2 = new ViewTracker(m2);
    tr2.update();
    m2.start();
    m2.env.tech[4] = 6;
    tr2.update();
    m2.submitAction(1, -1);
    tr2.update();
    m2.submitAction(3, 1);
    tr2.update();
    expect(tr2.getLog().some((e) => e.key === "log.ownReveal")).toBe(true);
});
