/**
 * 引擎测试共享构造器（Task 5 起从 reset.test.ts 抽出）。
 *
 * 队列语义：追加在基础 81 个构造值之后（72 pos=0.02 全同点 → 4 tech [1,2,3,4]
 * → 4 res [10,10,10,10] → 1 预滚 12.5）；fill 供余量。ScriptedRng 原样返回。
 */
import { DarkForestEnv2 } from "./env";
import { V24_CONFIG } from "./config";
import { ScriptedRng } from "./rng";

export function makeEnv(queue: number[] = [], fill = 0.5, overrides = {}) {
    return new DarkForestEnv2(
        { ...V24_CONFIG, ...overrides },
        new ScriptedRng(
            [
                ...Array(72).fill(0.02),
                1, 2, 3, 4,
                10, 10, 10, 10,
                12.5,
                ...queue,
            ],
            fill,
        ),
    );
}

/** beginTick + resolve 一步（reActions 缺省 = actions，同 python 测试惯例） */
export function tick(
    env: DarkForestEnv2,
    actions: Int32Array,
    targets: Int32Array | null = null,
    reActions: Int32Array | null = null,
) {
    const invaded = env.beginTick(actions, targets);
    return { invaded, result: env.resolve(reActions ?? actions) };
}
