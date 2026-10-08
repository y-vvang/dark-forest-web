import { expect, test } from "bun:test";

import { ScriptedRng } from "@/lib/engine/rng";
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
    const m = new SoloMatch(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
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
    // 高科技 df 对手互相残杀；玩家（tech 0.01）静默——该刻无交锋日志（仅⑩的出生条目），nAlive 下降可见
    const envRng = new ScriptedRng(
        [...Array(72).fill(0.02), 9, 9, 9, 9, 10, 10, 10, 10, 12.5],
        0.01,
    );
    const m = new SoloMatch(7, ["df"], new Map(), { envRng });
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
    expect(newEntries.map((e) => e.key)).toEqual(["log.born"]); // 仅⑩出生条目——无任何交锋事件（规则⑦）
    expect(tr.getLog().some((e) => e.key.startsWith("log.ownStrike"))).toBe(false);
    expect(tr.getLog().some((e) => e.key === "log.dark")).toBe(false); // 玩家一无所知
    expect(v.markers.filter((x) => x.state !== "self")).toEqual([]);
});

test("player detect → contact entries + known markers; observe fills intel (rules ③①)", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), {
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
    const m = new SoloMatch(7, ["pacifist"], new Map(), {
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
    const m = new SoloMatch(7, ["random"], new Map(), { envRng, presetRng });
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
    const m = new SoloMatch(7, ["random"], new Map(), { envRng: baseEnvRng(), presetRng });
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
    const m = new SoloMatch(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
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
    const m = new SoloMatch(7, ["pacifist"], new Map(), { envRng: baseEnvRng() });
    const tr = new ViewTracker(m);
    tr.update();
    m.start();
    const v1 = tr.update();
    m.submitAction(1, -1); // t1：内生出生 → log.born
    const v2 = tr.update();
    expect(v2.log.length).toBeGreaterThan(v1.log.length); // 事件确实积累了
    expect(v2.log).not.toBe(v1.log); // 但数组引用必须不同，否则 memo 化组件拿不到新内容
});

test("domain marker intel is FROZEN at the windup tick end (review Important 1)", () => {
    // env2.py:313 的 known_pair 只滤 ~in_domain 不滤 windup——观测情报喂到【声明刻末】，
    // 域生效刻起才掩蔽 → 快照点 = 风窗刻末 = 玩家收到 live 情报的最后时刻（精确，非近似）。
    // 场景：t0 幽灵刻 → t1 玩家探测全员 → t2 OBSERVE slot0 → t3 slot0 声明黑域 → t4 域内发展×0.2
    const presetRng = new ScriptedRng(
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 1, 1, 1, 1, 1, 1, 1], // t0..t4 各 4 席（出生已抑制）
        0.5,
    );
    const m = new SoloMatch(7, ["random"], new Map(), { envRng: baseEnvRng(0.025), presetRng });
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
