/**
 * Review Focus 5：UI 门理由与 env 掩码的 parity——穷举 576 组合
 * （8 动作 × tech 6 × res 3 × hasKnown 2 × domain 2 × windup 2），
 * 断言 gateOf 给出禁用理由的每个动作，env valid 同为非法。
 * v2.4：删 strikeWeak/strikeStrong；增 reveal（BOTHER 揭露：已知性 + 广播门）。
 * 反方向不要求：env 可因 gateOf 未覆盖的原因额外禁用（域/风窗行等，由会话层 valid 传递）。
 */
import { expect, test } from "bun:test";

import { makeEnv } from "@/lib/engine/test-helpers";
import { ACTION_NUM, gateOf, type ActionId } from "./gates";

const IDS: ActionId[] = [
    "silent", "develop", "broadcast", "reveal", "observe", "domain", "invade", "strike",
];
const TECHS = [0.5, 3, 5.1, 6, 7.1, 9];
const RES = [1, 10.1, 15];

test("gates parity: every gateOf-blocked action is invalid in env (576 combos)", () => {
    const violations: string[] = [];
    let checked = 0;
    for (const tech of TECHS) {
        for (const res of RES) {
            for (const hasKnown of [false, true]) {
                for (const domain of [0, 1]) {
                    for (const windup of [0, 1]) {
                        const env = makeEnv();
                        env.reset();
                        env.tech[0] = tech;
                        env.res[0] = res;
                        if (hasKnown) env.known[0 * 36 + 1] = 1; // 目标 1：活、非域、非风窗
                        env.in_domain[0] = domain;
                        env.domain_windup[0] = windup;
                        const valid = env.valid();
                        for (const id of IDS) {
                            if (gateOf(id, tech, res, hasKnown) !== null) {
                                checked++;
                                if (valid[ACTION_NUM[id]] === 1)
                                    violations.push(
                                        `${id} tech=${tech} res=${res} known=${hasKnown} dom=${domain} wnd=${windup}`,
                                    );
                            }
                        }
                    }
                }
            }
        }
    }
    expect(violations.join("; ")).toBe("");
    expect(checked).toBeGreaterThan(400); // 真实覆盖量（禁用情形确实存在）
});
