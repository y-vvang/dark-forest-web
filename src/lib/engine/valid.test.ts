import { expect, test } from "bun:test";

import { makeEnv } from "./test-helpers";

test("valid: gates by tech/broadcast (env2.py:257-286)", () => {
    const env = makeEnv();
    env.reset(); // techs [1,2,3,4]，res 全 10
    const v = env.valid();
    expect(v[0 * 10 + 0]).toBe(1); // SILENT 恒合法
    expect(v[0 * 10 + 2]).toBe(0); // BSELF：tech=1（不>1）、res=10（不>10）→ 禁
    expect(v[1 * 10 + 2]).toBe(1); // tech=2>1 → BSELF 合法
    expect(v[3 * 10 + 7]).toBe(0); // OBSERVE 需 tech>5
    expect(v[3 * 10 + 4]).toBe(0); // STRIKE 需 tech>7 且有已知目标
    expect(v[3 * 10 + 3]).toBe(0); // BOTHER 恒非法（已退役）
});

test("valid: strikeable requires known alive non-domain target", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 9;
    env.known[0 * 36 + 1] = 1; // 仅知 1 号
    const v = env.valid();
    expect(v[0 * 10 + 4]).toBe(1); // STRIKE
    expect(v[0 * 10 + 6]).toBe(1); // INVADE
    expect(v[0 * 10 + 7]).toBe(1); // OBSERVE（tech 9>5）
    expect(v[0 * 10 + 8]).toBe(1); // WEAK
    expect(v[0 * 10 + 9]).toBe(1); // STRONG
    env.in_domain[1] = 1; // 目标入域 → strikeable 失效
    const v2 = env.valid();
    expect(v2[0 * 10 + 4]).toBe(0);
    expect(v2[0 * 10 + 6]).toBe(0);
    expect(v2[0 * 10 + 7]).toBe(0);
});

test("valid: shielded rows forbid advanced incl BSELF; dead keep SILENT; BOTHER never valid", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 9;
    env.domain_windup[0] = 1;
    const v = env.valid();
    for (const a of [2, 4, 6, 7, 8, 9]) expect(v[0 * 10 + a]).toBe(0); // 域/风窗行清高级动作
    expect(v[0 * 10 + 1]).toBe(1); // DEVELOP 仍可
    env.alive[1] = 0;
    const v2 = env.valid();
    expect(v2[1 * 10 + 0]).toBe(1); // 死者仅 SILENT
    for (const a of [1, 2, 4, 5, 6, 7]) expect(v2[1 * 10 + a]).toBe(0);
});

test("valid: BD gate + disable switch; strikes need tech>7 even with targets", () => {
    const env = makeEnv();
    env.reset();
    env.tech[0] = 6;
    env.known[0 * 36 + 1] = 1;
    const v = env.valid();
    expect(v[0 * 10 + 5]).toBe(1); // BD: 6>5
    expect(v[0 * 10 + 4]).toBe(0); // STRIKE: 6≤7
    expect(v[0 * 10 + 7]).toBe(1); // OBSERVE: 6>5 且有已知
    const env2_ = makeEnv([], 0.5, { enableBlackDomain: false });
    env2_.reset();
    env2_.tech[0] = 9;
    const v2 = env2_.valid();
    expect(v2[0 * 10 + 5]).toBe(0); // 开关关闭 → BD 全禁
});

test("selectTargets: candidate mask only for INVADE/STRIKE rows; no windup filter (env2.py:334-340)", () => {
    const env = makeEnv();
    env.reset();
    env.known[0 * 36 + 1] = 1;
    env.known[0 * 36 + 2] = 1;
    env.in_domain[2] = 1;
    env.domain_windup[3] = 1;
    env.known[0 * 36 + 3] = 1;
    const actions = new Int32Array(36);
    actions[0] = 6; // INVADE
    actions[5] = 4; // STRIKE（5 号不知任何人）
    const m = env.selectTargets(actions);
    expect(m[0 * 36 + 1]).toBe(1);
    expect(m[0 * 36 + 2]).toBe(0); // 域内目标排除
    expect(m[0 * 36 + 3]).toBe(1); // 风窗目标不排除（与 valid 的 strikeable 不同——照抄）
    for (let j = 0; j < 36; j++) expect(m[5 * 36 + j]).toBe(0); // 非目标动作行全 False
});
