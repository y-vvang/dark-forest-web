# 游戏机制阶段实施计划（引擎移植 + 一致性验收 + 对手接入 + 单机会话）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/game-mechanics.md` v1.0 实现：DarkForestEnv2 的 TS 忠实移植（过 5 点一致性验收门）+ DQN/预制策略对手 + 单机会话层与 /match 真数据接线，模式 (a) 端到端可玩。

**Architecture:** 三层——`src/lib/engine`（纯 TS 环境，Rng 注入式：GameRng 运行时 / ScriptedRng 单测 / ReplayRng 金标准回放）→ `src/lib/opponents`（DQN float64 前向 + 预制策略）→ `src/lib/solo`（会话状态机 + 感知过滤视图）。UI 组件只消费视图模型。金标准 = Python 端录制 RNG 消耗流，TS 端逐刻全状态精确回放比对。

**Tech Stack:** bun + TypeScript（strict）+ Next.js 16 + Tailwind v4；测试 `bun test`（内置）+ `@types/bun`（唯一新 devDep）；开发期 Python（PYTHONUTF8=1，只读引用 experiment/）。

**Spec:** `docs/game-mechanics.md`（v1.0，2026-10-01 已批准）——本计划一切决策以其为准；其上游为 `docs/env-model-v23.md`（含 Q1-Q12）与 `docs/ai-opponents.md`。环境行为最终权威 = `experiment/experiment/env2.py`。

## Global Constraints

- `experiment/` **零改动**（Python 脚本只经 sys.path 只读引用）；Python 仅开发期、必须 `PYTHONUTF8=1`。
- **运行时依赖零新增**；devDep 仅 `@types/bun`。环境参数零偏离：一切数值来自 `config_v23.yaml`（经 `V23_CONFIG`）。
- 引擎/对手/会话层 **不 import React**；`bun test` 须能脱离浏览器跑 `src/lib/**`。UI 约束：无 `<canvas>`、无 JS 动画（仅 CSS）、默认字体 + `monospace`。
- 新 UI 文案唯一流程：`DESIGN.md §7` 双语表先行 → `en.ts`（类型源）+ `zh.ts`（缺键=编译错误）→ 组件。组件层禁止硬编码可见字符串。全站无语言切换控件；i18n 用 `useSyncExternalStore`（勿改回 useState+useEffect）。
- `"use client"` 仅存在于页面组件与 `src/components/client-layout.tsx`；`src/components/*` 其余不加。
- 每个 `resolve` 相关测试都跑守恒断言：`|总量 − Σ存活资源 − 自由池| ≤ 1e-6`（每刻）。
- 引擎字段/方法名与 env2.py **一一对应（snake_case）**：`tech/res/alive/known/observed/public/in_domain/domain_windup/pending_reveal/pending_counter/last_action/first_detect_tick/free_pool/pending_spawns/birth_log/death_cause/spawn_tick/spawn_tech/spawn_res/peak_tech/t`；`_obs→obs()`、`_valid→valid()`、`select_targets→selectTargets`、`begin_tick→beginTick`、`_activate_pending_spawns→activatePendingSpawns`、`_pair_dist→pairDist`。
- **git 提交**：工作树当前全 untracked，用户未授权提交——执行时若用户未明确同意，**跳过所有 commit 步骤**，其余照常。
- 常用验证命令：`bun test`（本计划主要红绿循环）、`bun run check`（typegen+eslint+tsc，含 zh 词典完整性）、`bun run build`。

## Review Focus（规格隐含、任务测试须钉住的 5 个失效模式）

1. **RNG 消耗序漂移**：resolve 中任何一次抽样增删/换位都会错位整条金标准轨迹 → ReplayRng 在 golden-replay 测试中**断言每次调用的方法+参数**（Task 14）。
2. **感知泄漏**：全知 info 事件被渲染进玩家日志（如他人间打击）→ 会话测试：构造他人互打刻，断言 view.log 不含该事件（Task 19）。
3. **模型权重转换精度**：npz→JSON 往返丢位 → dqn-parity |ΔQ|≤1e-12 逐模型（Task 17）。
4. **终局/状态边界**：done 后再 resolve 崩溃、t=250 边缘多结算一刻、玩家死后仍可提交 → env 测试断言 done 后 resolve 抛错（Task 9）；会话测试断言 ended 后 submit 抛错（Task 19）。
5. **行动门 UI 与 env 失同步**：ActionGrid 的 gateOf() 理由与 env `valid[]` 掣肘 → UI 接线任务中加 parity 测试：对随机状态采样断言 gateOf 禁用集 ⊆ env 无效集（Task 22）。

## 文件地图（创建/修改全表）

```
创建:
  src/lib/engine/config.ts         V23_CONFIG + EnvConfig
  src/lib/engine/types.ts          ActionId/TickInfo/StrikeEvent/TickResult/DeathCause
  src/lib/engine/rng.ts            Rng 接口 + GameRng + ScriptedRng + ReplayRng + seedOf
  src/lib/engine/env.ts            DarkForestEnv2 移植
  src/lib/engine/snapshot.ts       snapshot()/compareState()/assertConservation()
  src/lib/engine/testdata-io.ts    轨迹 gzip+base64 读写（node:zlib）
  src/lib/engine/*.test.ts          七个测试文件（见各任务）
  src/lib/engine/testdata/*.json.gz 金标准轨迹 + stats.json + dqn-outputs.json + README.md
  src/lib/opponents/catalog.ts     12 模型 + 3 预制清单
  src/lib/opponents/dqn.ts         ModelWeights/forward/actBatch/loadModel
  src/lib/opponents/presets.ts     heuristicAction/pickTarget
  src/lib/solo/match.ts            SoloMatch 状态机（座位/逐刻/重选/终局）
  src/lib/solo/view.ts             感知过滤 + MatchView
  src/lib/solo/*.test.ts           会话/视图测试
  scripts/golden/record_golden.py  金标准录制（+ stats.json）
  scripts/golden/convert_models.py npz→public/models/*.json
  scripts/golden/record_dqn_outputs.py 前向奇偶录制
  docs/superpowers/plans/          本计划
修改:
  package.json                      +"test": "bun test"，+@types/bun
  tsconfig.json                      仅当 @types/bun 与 node 冲突时加 "types"
  next.config.ts                     +headers(/models/* immutable)
  src/app/solo/page.tsx              选择态 + 开始对局跳转
  src/app/match/page.tsx             会话接线，demo bar 移除
  src/components/action-grid.tsx     接受 valid[]（内部 gateOf 保留做理由）
  src/components/event-log.tsx       无结构变化（数据源换视图模型）
  src/i18n/en.ts / zh.ts             新键（先 DESIGN §7）
  DESIGN.md §7                       新键双列
  CLAUDE.md                          命令/状态/备忘
删除（随接线）:
  src/lib/mock.ts 中 MATCH/CIVS/EVENTS/SELF* 等对局 mock（/online 仍用的 ONLINE/PRESETS/MODELS 保留或移至 catalog）
```

---

## M1：引擎移植 + 脚本化用例

### Task 1: bun test 基建

**Files:** Modify `package.json`（scripts + devDependencies）；Create `src/lib/engine/smoke.test.ts`

**Interfaces:** Produces: `bun test` 可用；`import { test, expect } from "bun:test"` 在 tsc 下可查。

- [ ] **Step 1: 加 test script + 类型包**

`package.json` scripts 增 `"test": "bun test"`；`bun add -d @types/bun`。

- [ ] **Step 2: 冒烟测试**

```ts
// src/lib/engine/smoke.test.ts
import { expect, test } from "bun:test";

test("bun test runs", () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 3: 跑通并验证 check**

Run: `bun test && bun run check`
Expected: 1 pass；check 全绿。若 tsc 报 @types/bun 与 @types/node 冲突：tsconfig `compilerOptions` 加 `"types": ["node", "@types/bun"]` 后重验。

- [ ] **Step 4: Commit**（如获授权）`git add package.json bun.lock src/lib/engine/smoke.test.ts tsconfig.json && git commit -m "test: bun test bootstrap"`

### Task 2: config.ts + types.ts

**Files:** Create `src/lib/engine/config.ts`、`src/lib/engine/types.ts`；Test `src/lib/engine/config.test.ts`

**Interfaces:** Produces: `V23_CONFIG: EnvConfig`、`interface EnvConfig`（字段同下表）、`ActionId`/`A_SILENT..A_STRIKE_STRONG`（0-9）、`N_ACTIONS=10`、`NEAR_K=3`、`OBS_DIM=38`、`TickInfo`（snake_case 键，见 Task 9）、`TickResult`。

- [ ] **Step 1: 失败测试（参数逐项锁定 config_v23.yaml）**

```ts
// src/lib/engine/config.test.ts
import { expect, test } from "bun:test";
import { V23_CONFIG } from "./config";
import { N_ACTIONS, NEAR_K, OBS_DIM } from "./types";

test("V23_CONFIG matches config_v23.yaml env section", () => {
    expect(V23_CONFIG).toEqual({
        nAgents: 36, world: 100.0, detectRadius: 30.0, tMax: 250,
        pDetectBase: 0.03, stealthMult: 0.25, pDetectMax: 0.35, pExplosion: 0.01,
        developRate: 0.05, techCap: 1_000_000.0, techSpawnLo: 0.5, techSpawnHi: 10.0,
        killBase: 0.55, killTechSlope: 0.12, resMin: 5.0, resMax: 20.0,
        resTotalBudget: 150.0, shieldCostFrac: 0.5, softsignA: 0.2, softsignRewardScale: 0.01,
        pDeplete: 0.02, depleteLo: 0.5, depleteHi: 2.0,
        gateBroadcastTech: 1.0, gateBroadcastRes: 10.0, gateObserveTech: 5.0,
        gateDomainTech: 5.0, gateStrikeTech: 7.0,
        developReward: 0.05, deathPenalty: 10.0, bdEntryPenalty: 0.5,
        bdGrowthMult: 0.2, bdExplosionMult: 0.1, enableBlackDomain: true,
        spawnSchedule: [[0, 4]],
    });
    expect(N_ACTIONS).toBe(10); expect(NEAR_K).toBe(3); expect(OBS_DIM).toBe(38);
});
```

- [ ] **Step 2:** Run `bun test src/lib/engine/config.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现**——`types.ts`：`export const A_SILENT = 0 as const; … A_STRIKE_STRONG = 9 as const; export type ActionId = 0|…|9; export type DeathCause = ""|"strike"|"invade"|"mutual"|"starve";` `TickResult = { obs: Float32Array; valid: Uint8Array; rewards: Float64Array; alive: Uint8Array; done: boolean; info: TickInfo; deadNow: Uint8Array }`；`TickInfo`/`StrikeEvent` 定义放此（字段名 snake_case：`detections/strikes/invasions/loot_to/died_this_tick/strikes_blocked/strike_events/free_pool/res_conservation_residual/n_births/n_alive/in_domain/counter_detections`）。`config.ts`：`EnvConfig` 接口（上表字段 + `seed: number` 放构造参数）+ `V23_CONFIG`。
- [ ] **Step 4:** Run 同 Step 2 → PASS。
- [ ] **Step 5: Commit** `feat(engine): config + types`

### Task 3: rng.ts

**Files:** Create `src/lib/engine/rng.ts`；Test `src/lib/engine/rng.test.ts`

**Interfaces:** Produces:
```ts
export interface Rng {
    uniform(): number;                                   // [0,1)
    uniformRange(lo: number, hi: number): number;
    uniformArray(size: number, lo?: number, hi?: number): Float64Array;  // lo/hi 默认 0/1；矩阵也走此（行主序平铺）
    choice(candidates: readonly number[]): number;
}
export function seedOf(matchSeed: number, domain: string): number;      // splitmix64(matchSeed ^ tag)
export class GameRng implements Rng { constructor(seeds: number[]); }   // sfc32
export class ScriptedRng implements Rng { constructor(queue: number[], fill?: number); consumed: number; }
export class ReplayRng implements Rng { constructor(log: TraceDraw[], onError?: (msg: string) => void); exhausted: boolean; }
```

- [ ] **Step 1: 失败测试**

```ts
// src/lib/engine/rng.test.ts
import { expect, test } from "bun:test";
import { GameRng, ScriptedRng, seedOf } from "./rng";

test("GameRng deterministic + half-open", () => {
    const a = new GameRng([42]); const b = new GameRng([42]);
    const u = a.uniform();
    expect(u).toBe(b.uniform());
    expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1);
    expect(seedOf(42, "env")).toBe(seedOf(42, "env"));
    expect(seedOf(42, "env")).not.toBe(seedOf(42, "agent:0"));
});
test("ScriptedRng pops queue then fill; counts consumption", () => {
    const r = new ScriptedRng([1, 2, 3, 4], 0.5);
    expect(r.uniformArray(2)).toEqual(new Float64Array([1, 2])); // 直接返回脚本值，不做缩放
    expect(r.choice([7, 8, 9])).toBe(3);
    expect(r.uniformRange(0, 100)).toBe(50);                     // 队列尽 → fill=0.5
    expect(r.consumed).toBe(4);
});
```

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**——`seedOf`：FNV-1a 32 hash of `domain` → 与 matchSeed 混合 → splitmix64 一轮，返回 32bit 种子。`GameRng`：sfc32（4×32bit 状态由 splitmix64 链扩展 seeds；`uniform()` 用 53 位构造 `(a*2**21 + (b>>>11)) / 2**53`，两次 next32；`uniformRange = lo + (hi−lo)*uniform()`；`uniformArray` 逐元素；`choice(cands)` = `cands[floor(uniform()*len)]`，`floor` 后若 == len 减 1 防边界）。`ScriptedRng`：队列值**原样返回**（不缩放——测试直接控制期望返回值）；耗尽后 uniform 类调用返回 `fill`（默认 0.5），`choice` 返回 `candidates[floor(fill*len)]`；`consumed` 计数。`ReplayRng`（本任务先立骨架，Task 14 实战）：`uniform/...` 从 log 弹出并校验 `m` 与 args（size 校验：数组/矩阵按乘积、choice 按候选集逐元素）；标量返回 `v`；数组经 base64 解码（`testdata-io.ts` 的 decode 依赖放 Task 14 再引，此处 `v` 先支持标量与数字数组字面量两种形态）。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(engine): rng interface + implementations`

### Task 4: env.ts 骨架 + reset

**Files:** Create `src/lib/engine/env.ts`、`src/lib/engine/snapshot.ts`；Test `src/lib/engine/reset.test.ts`

**Interfaces:** Produces: `class DarkForestEnv2 { constructor(cfg: EnvConfig, rng: Rng); reset(seed?: number): { obs, valid }; … }`（后续任务补方法）；`snapshot.ts`: `snapshot(env): EnvSnapshot`（全字段纯对象）、`compareState(a, b, tol=1e-12): string | null`（返回首个差异描述）、`assertConservation(env): void`。

- [ ] **Step 1: 失败测试（reset 全不变量）**

```ts
// src/lib/engine/reset.test.ts
import { expect, test } from "bun:test";
import { DarkForestEnv2 } from "./env";
import { V23_CONFIG } from "./config";
import { ScriptedRng } from "./rng";
import { assertConservation } from "./snapshot";

/** 队列：72 个 pos-u（0.02→坐标 2）、4 tech（1,2,3,4）、4 res（10）、1 预滚（12.5） */
function makeEnv(queue: number[] = [], fill = 0.5, overrides = {}) {
    return new DarkForestEnv2(
        { ...V23_CONFIG, ...overrides },
        new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5, ...queue], fill));
}

test("reset: initial cohort of 4, conservation, pending pre-roll", () => {
    const env = makeEnv();
    const { obs, valid } = env.reset();
    expect(env.n).toBe(36);
    expect(Array.from(env.alive).filter(Boolean)).toHaveLength(4);   // 初始 4 活
    expect([...env.tech.slice(0, 4)]).toEqual([1, 2, 3, 4]);
    expect([...env.res.slice(0, 4)]).toEqual([10, 10, 10, 10]);
    expect(env.free_pool).toBe(110);                                  // 150 − 40
    expect(env.pending_spawns).toEqual([12.5]);                       // 恰一个预滚
    expect(env.spawn_tick.slice(0, 4).every((t) => t === 0)).toBe(true);
    expect(env.spawn_tick.slice(4).every((t) => t === 10 ** 9)).toBe(true);
    expect(env.t).toBe(0);
    expect(obs.length).toBe(36 * 38);
    expect(valid.length).toBe(36 * 10);
    assertConservation(env);                                          // 150 − 40 − 110 = 0
});
test("reset: budget overflow scales initial res (env2.py:191-192)", () => {
    const env = makeEnv([...Array(72).fill(0.02), 1, 2, 3, 4, 40, 40, 40, 40, 12.5]);
    env.reset();
    // Σres0 = 160 > 150 → 缩放为 150；tech 门槛不受影响
    expect([...env.res.slice(0, 4)].reduce((s, v) => s + v, 0)).toBeCloseTo(150, 10);
    expect(env.free_pool).toBeCloseTo(0, 10);
    assertConservation(env);
});
test("consecutive resets: Q1 stale-pos preserved (env2.py:171)", () => {
    const env = makeEnv();
    env.reset();
    // 再次 reset 时位置拒绝采样读取上一次的 pos（env2.py:171）——内部字段 prevPos 保留
    env.reset();
    expect(env["prevPos"]).toBeDefined();   // TS 无 reset(seed)：播种在构造期 DI 完成
});
```

- [ ] **Step 2:** Run → FAIL（类不存在）。
- [ ] **Step 3: 实现**——逐行移植 env2.py:73-216：构造器存 cfg 各参数 + `this.rng`（注入）；`reset(seed?)`（env2.py:164-216）：pos 抽样（`uniformArray(n*2, 0, world)` 填 `Float64Array(n*2)`，行 i = [2i, 2i+1]）；拒绝环（≤400 次；`d = pairDist(prevPos) if prevPos else 全 inf`；bad = 非对角且 d<12；首个 bad 对 re-roll 一次 `uniformArray(2)` 后 break——注意只重掷 `pos[i]` 一行两值）；**`this.prevPos = pos`（Q1）**；tech0/res0/res 缩放/free_pool/pending_spawns 首滚/spawn_tick（n0=4 起始 0，其余 1e9）/known(n×n Uint8Array)/observed/public/in_domain/domain_windup/pending_reveal=[]/pending_counter=[]/last_action 全 A_SILENT/first_detect_tick(n×n Int32Array 全 −1)/death_cause/peak_tech/birth_log=[]；返回 `{ obs: this.obs(), valid: this.valid() }`（obs/valid 本任务先实现**占位**——Task 5/10 补全前，reset 测试只断言长度）。`snapshot.ts`：`snapshot` 枚举全字段为纯数组对象；`compareState` 逐字段（整数/布尔/串精确，浮点 |Δ|≤tol）；`assertConservation`：`|cfg.resTotalBudget − Σalive res − free_pool| ≤ 1e-6`。
- [ ] **Step 4:** Run → PASS（reset 长度断言经占位 obs/valid 通过）。
- [ ] **Step 5: Commit** `feat(engine): env skeleton + reset`

### Task 5: valid() + selectTargets()

**Files:** Modify `src/lib/engine/env.ts`（补 `valid`/`selectTargets`）；Test `src/lib/engine/valid.test.ts`

**Interfaces:** Consumes Task 4 env。Produces: `valid(): Uint8Array`（n×10 平铺，`valid[i*10+a]`）、`selectTargets(actions: Int32Array): Uint8Array`（n×n 平铺）。

- [ ] **Step 1: 失败测试**（沿用 Task 4 的 makeEnv helper，抽到 `src/lib/engine/test-helpers.ts` 导出 `makeEnv`）

```ts
// src/lib/engine/valid.test.ts  （节选三个关键用例，其余见 Step 3 清单）
test("valid: gates by tech/broadcast (env2.py:257-286)", () => {
    const env = makeEnv(); env.reset();   // techs [1,2,3,4]，res 全 10
    const v = env.valid();
    expect(v[0 * 10 + 0]).toBe(1);        // SILENT 恒合法
    expect(v[0 * 10 + 2]).toBe(0);       // BSELF：tech=1（不 >1）、res=10（不 >10）→ 禁
    expect(v[1 * 10 + 2]).toBe(1);        // tech=2>1 → BSELF 合法
    expect(v[3 * 10 + 7]).toBe(0);       // OBSERVE 需 tech>5
    expect(v[3 * 10 + 4]).toBe(0);       // STRIKE 需 tech>7 且有已知目标
});
test("valid: strikeable requires known alive non-domain target", () => {
    const env = makeEnv(); env.reset();
    env.tech[0] = 9; env.known[0 * 36 + 1] = 1;      // 仅知 1 号
    const v = env.valid();
    expect(v[0 * 10 + 4]).toBe(1); expect(v[0 * 10 + 6]).toBe(1); expect(v[0 * 10 + 7]).toBe(1);
    env.in_domain[1] = 1;                              // 目标入域
    const v2 = env.valid();
    expect(v2[0 * 10 + 4]).toBe(0);
});
test("valid: shielded rows forbid advanced incl BSELF; dead keep SILENT; BOTHER never valid", () => {
    const env = makeEnv(); env.reset();
    env.tech[0] = 9; env.domain_windup[0] = 1;
    const v = env.valid();
    for (const a of [2, 4, 6, 7, 8, 9]) expect(v[0 * 10 + a]).toBe(0);
    expect(v[1 * 10 + 3]).toBe(0);                    // BOTHER 恒非法（对所有行）
    env.alive[1] = 0;
    const v2 = env.valid();
    expect(v2[1 * 10 + 0]).toBe(1);                   // 死者仅 SILENT
    for (const a of [1, 2, 4, 6, 7]) expect(v2[1 * 10 + a]).toBe(0);
});
test("selectTargets: candidate mask only for INVADE/STRIKE rows", () => {
    const env = makeEnv(); env.reset();
    env.known[0 * 36 + 1] = 1; env.known[0 * 36 + 2] = 1; env.in_domain[2] = 1;
    const actions = new Int32Array(36).fill(0);
    actions[0] = 6;                                    // INVADE
    const m = env.selectTargets(actions);
    expect(m[0 * 36 + 1]).toBe(1); expect(m[0 * 36 + 2]).toBe(0);   // 域内目标排除
});
```

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**——移植 env2.py:256-286（valid：strikeable 行向量 = known & alive[j] & ~in_domain[j] & ~windup[j] 任一存在；BOTHER 恒 0；各 gate；shielded=in_domain|windup 行清 2/4/6/7/8/9；非 alive 行全 0 唯 SILENT=1）与 env2.py:334-340（selectTargets：need = actions∈{INVADE,STRIKE}；行 = need & known & alive & ~in_domain——**注意 selectTargets 的行不含 ~windup**，与 valid 的 strikeable 不同，照抄）。其余用例（一并覆盖）：`enableBlackDomain=false 时 BD 全禁`（overrides）；`tech=9 且知 3 目标时 WEAK/STRONG 合法`。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(engine): valid mask + target candidates`

### Task 6: beginTick()（入侵通知）

**Files:** Modify `env.ts`；Test `src/lib/engine/begin-tick.test.ts`

**Interfaces:** Produces: `beginTick(actions: Int32Array, targets: Int32Array | null): number[]`（受入侵者 slot 列表，升序）。

- [ ] **Step 1: 失败测试**

```ts
test("beginTick: invasion notice reveals invader to victim NOW (env2.py:353-360)", () => {
    const env = makeEnv(); env.reset();
    env.known[0 * 36 + 1] = 1;
    const actions = new Int32Array(36); actions[0] = 6;   // INVADE
    const targets = new Int32Array(36).fill(-1); targets[0] = 1;
    const invaded = env.beginTick(actions, targets);
    expect(invaded).toEqual([1]);
    expect(env.known[1 * 36 + 0]).toBe(1);               // 受害者得知入侵者
    expect(env.first_detect_tick[1 * 36 + 0]).toBe(0);
});
test("beginTick: invalid target not stored; STRIKE targets stored; not-alive skip", () => {
    const env = makeEnv(); env.reset();
    const actions = new Int32Array(36); actions[0] = 6; actions[2] = 4;
    const targets = new Int32Array(36).fill(-1); targets[0] = 5; targets[2] = 1;
    env.beginTick(actions, targets);                     // 0 不知 5 → 不入
    expect(env.selectTargets(actions)[0 * 36 + 5]).toBe(0);
    expect(env["_targets"][2]).toBe(1);
    env.alive[3] = 0; actions[3] = 6; targets[3] = 1; env.known[3 * 36 + 1] = 1;
    expect(env.beginTick(actions, targets)).not.toContain(1); // 双方须活（3 已死）→ 不产生通知
});
```

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**——移植 env2.py:342-360：`_actions=copy`；`_targets={}`：对 actions∈{INVADE,STRIKE} 的行 i，`j=targets[i]`，若 `j>=0 且 selectTargets(_actions)[i,j]` 则存；入侵通知：对每 (i,j)∈_targets 且 action=INVADE 且双方 alive → `known[j,i]=1`、`first_detect_tick[j,i]=t`、`_invaders[j]=i`；返回排序键列表。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(engine): beginTick + invasion notices`

---

### Task 7: resolve() 第一段（sanitize → 域激活 → 反曝光 → 延迟广播 → 被动探测 → 广播入队）

**Files:** Modify `env.ts`（resolve 全骨架 + 六个阶段私有方法，本任务填 0-3）；Create `src/lib/engine/test-helpers.ts`；Test `src/lib/engine/resolve-a.test.ts`

**Interfaces:** Produces: `resolve(reActions: Int32Array): TickResult`（全程可调用；本任务结束时阶段 4-10 的私有方法为空方法体，info 对应字段为空/零值）；`tick(env, actions, targets?, reActions?)` helper。

- [ ] **Step 1: 先立 resolve 骨架契约测试（空阶段行为）+ test-helpers**

```ts
// src/lib/engine/test-helpers.ts
import { DarkForestEnv2 } from "./env";
import { V23_CONFIG } from "./config";
import { ScriptedRng } from "./rng";
export function makeEnv(queue: number[] = [], fill = 0.5, overrides = {}) {
    return new DarkForestEnv2({ ...V23_CONFIG, ...overrides },
        new ScriptedRng([...Array(72).fill(0.02), 1, 2, 3, 4, 10, 10, 10, 10, 12.5, ...queue], fill));
}
export function tick(env, actions, targets = null, reActions = null) {
    const invaded = env.beginTick(actions, targets);
    return { invaded, result: env.resolve(reActions ?? actions) };
}
```
`resolve-a.test.ts` 第一个用例：`tick(env, new Int32Array(36))` 返回 TickResult：`t` 变 1、`last_action` 全 0（SILENT）、`done=false`、`info` 各列表为空、`assertConservation(env)` 通过。

- [ ] **Step 2:** Run → FAIL（resolve 不存在）。

- [ ] **Step 3: 实现** resolve 骨架（env2.py:362-375）+ 阶段 0-3：
  - **sanitize**（env2.py:373-393）：`actions=_actions.copy()`；invaded 行覆盖 reActions；`any_known = (known & alive).any(row)`；无 known 而选了 STRIKE/WEAK/STRONG/INVADE/OBSERVE 的行 eff=SILENT；in_domain|windup 行仅保留 {DEVELOP, BDOMAIN, SILENT} 否则 SILENT；strike/observe/domain/broadcast 各 tech 门槛防御性钳为 SILENT；`enable_black_domain=false` 时 BD→SILENT。
  - **阶段 0 域激活**（env2.py:395-400）：`in_domain |= windup`；`windup=0`；`entering = eff==BD & alive & ~in_domain & ~windup`；`rewards[entering] −= 0.5`；`windup |= entering`。
  - **阶段 0.5 反曝光**（env2.py:402-418）：对 pending_counter 中仍活且非域的 i：cand = 活且非域且 ≠i；`k = rng.choice(cand)`；若 `known[k,i]==0` → 置位、first_detect_tick、detections 追加 `(k,i)`、`n_counter++`；清空 pending_counter。
  - **阶段 1 延迟广播**（env2.py:420-425）：对 pending_reveal 每个 `(kind, j)`：`known[aliveRows, j]=1`、`public[j]=1`（发送者已死照常生效）。
  - **阶段 2 被动探测**（env2.py:427-442）：`stealth[j] = eff[j]==SILENT`；`p_det[i,j] = min(0.03·√tech[i] · (0.25 if stealth[j] else 1), 0.35)`；探测者在域/风窗的行全 0；目标在域的列全 0（**风窗目标可被探测**）；mask = alive[i] & alive[j] & !known[i,j] & dist≤30 & i≠j；`u = rng.uniformArray(n*n)`（一次调用，恒发生）；命中按行主序 for 循环追加 detections。注意 dist 用 `pairDist()`。
  - **阶段 3 广播入队**（env2.py:444-450）：eff==BSELF 且 alive → pending_reveal 追加 `["self", i]`。
  - 尾部骨架：`last_action=eff`；`t+=1`；组装 info（本阶段空的为零值）；返回 TickResult（obs/valid 调已有方法）。**阶段 4-10 声明为空私有方法**（`private stageStrikes() {}` 等，Task 8/9 填）。

- [ ] **Step 4: 写阶段 0-3 的测试并跑绿**（`resolve-a.test.ts`，逐条）：

```ts
test("sanitize: no-known striker downgraded to SILENT; domain rows keep only DEV/BD/SILENT", () => {
    const env = makeEnv(); env.reset();
    const actions = new Int32Array(36); actions[0] = 4;      // 无任何 known
    actions[1] = 4; env.known[1 * 36 + 2] = 1; env.in_domain[1] = 1;   // 域内打击 → SILENT
    tick(env, actions);
    expect(env.last_action[0]).toBe(0); expect(env.last_action[1]).toBe(0);
});
test("domain: declare BD → windup now, active next tick, -0.5 reward", () => {
    const env = makeEnv(); env.reset();                       // techs [1,2,3,4]
    env.tech[0] = 6;
    const actions = new Int32Array(36); actions[0] = 5;
    const { result } = tick(env, actions);
    expect(env.domain_windup[0]).toBe(1); expect(env.in_domain[0]).toBe(0);
    expect(result.rewards[0]).toBe(-0.5);
    tick(env, new Int32Array(36));
    expect(env.in_domain[0]).toBe(1); expect(env.domain_windup[0]).toBe(0);
});
test("counter-detection: observer exposed to one random alive civ (scripted choice)", () => {
    const env = makeEnv([/* choice → cand[2] */ 2], 0.5); env.reset();
    env.pending_counter = [0];                               // 手工置待曝光者
    const { result } = tick(env, new Int32Array(36));
    expect(env.known[2 * 36 + 0]).toBe(1);
    expect(result.info.detections).toEqual([[2, 0]]);
    expect(result.info.counter_detections).toBe(1);
});
test("delayed broadcast resolves even if sender died (dying curse, env2.py:420-425)", () => {
    const env = makeEnv(); env.reset();
    env.pending_reveal = [["self", 2] as [string, number]];
    env.alive[2] = 0;                                         // 发送者已死
    tick(env, new Int32Array(36));
    expect(env.known[2 * 36 + 2]).toBe(1);                   // Q2: 广播者自知 known[j,j]
    expect(env.known[0 * 36 + 2]).toBe(1); expect(env.public[2]).toBe(1);
});
test("passive detection: p matrix, stealth, row-major order (env2.py:427-442)", () => {
    const env = makeEnv([], 0.2); env.reset();                // 全部坐标 (2,2) → 距离 0 ≤ 30
    env.tech[0] = 100;                                        // p_det 行0 = min(0.3, 0.35) = 0.3 > 0.2
    const { result } = tick(env, new Int32Array(36).fill(1)); // 全 DEVELOP（非静默）
    expect(result.info.detections).toEqual([[0, 1], [0, 2], [0, 3]]);
    expect(env.known[0 * 36 + 1]).toBe(1);
});
test("stealth: SILENT target ×0.25 → 0.075 < 0.2 不被发现；域内探测者行全零", () => {
    const env = makeEnv([], 0.2); env.reset();
    env.tech[0] = 100;
    const actions = new Int32Array(36).fill(1); actions[3] = 0;   // 3 号静默
    const { result } = tick(env, actions);
    expect(result.info.detections).toEqual([[0, 1], [0, 2]]);
    // 域内探测者
    const env2_ = makeEnv([], 0.2); env2_.reset(); env2_.tech[0] = 100; env2_.in_domain[0] = 1;
    const r2 = tick(env2_, new Int32Array(36).fill(1));
    expect(r2.result.info.detections).toEqual([]);
});
test("broadcast queued this tick reveals next tick", () => {
    const env = makeEnv(); env.reset(); env.tech[0] = 6;
    const actions = new Int32Array(36); actions[0] = 2;
    tick(env, actions);
    expect(env.pending_reveal).toEqual([["self", 0]]);
    tick(env, new Int32Array(36));
    expect(env.public[0]).toBe(1); expect(env.known[1 * 36 + 0]).toBe(1);
});
```

- [ ] **Step 5:** Run `bun test src/lib/engine` → 全 PASS（含 Task 4-6 旧用例不回归）。
- [ ] **Step 6: Commit** `feat(engine): resolve stages 0-3`

### Task 8: resolve() 第二段（打击/护盾 + 入侵/互毁/掠夺 + 置死）

**Files:** Modify `env.ts`（`stageStrikes`/`stageInvasions`）；Test `src/lib/engine/resolve-b.test.ts`

**Interfaces:** Consumes Task 7 骨架。Produces: info 的 `strikes/strikes_blocked/strike_events/invasions/loot_to` + alive/death_cause 置死。

- [ ] **Step 1: 失败测试**（节选；其余用例清单见 Step 3）

```ts
test("strike kill: alive cleared, cause=strike, corpse to pool (env2.py:467-507)", () => {
    const env = makeEnv(); env.reset();
    env.pending_spawns[0] = 9999;                  // 抑制同刻出生，pool 断言才封闭
    env.known[0 * 36 + 1] = 1; env.tech[0] = 8; env.tech[1] = 1;
    const actions = new Int32Array(36); actions[0] = 4;
    const targets = new Int32Array(36).fill(-1); targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(env.alive[1]).toBe(0); expect(env.death_cause[1]).toBe("strike");
    expect(result.info.strike_events).toEqual([[0, 1, "killed", 8, 1, 0]]);
    expect(result.info.died_this_tick).toEqual([[1, "strike"]]);
    expect(env.free_pool).toBeCloseTo(110 + 10, 10);   // 尸体（默认 res 10）入池
    assertConservation(env);
});
test("shield block: tech_j >= 2*tech_i, no RNG consumed (Q12)", () => {
    const env = makeEnv(); env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1; env.tech[0] = 8; env.tech[1] = 20; env.res[1] = 10;
    const actions = new Int32Array(36); actions[0] = 4;
    const targets = new Int32Array(36).fill(-1); targets[0] = 1;
    const before = (env["rng"] as ScriptedRng).consumed;
    const { result } = tick(env, actions, targets);
    expect(env.alive[1]).toBe(1);
    expect(result.info.strikes_blocked).toEqual([[0, 1, 5]]);
    expect(result.info.strike_events[0][2]).toBe("blocked");
    expect(env.res[1]).toBeCloseTo(5, 10); expect(env.free_pool).toBeCloseTo(115, 10);
    // consumed 按"值"计数：仅 +1296（探测矩阵那次调用），掷骰零消耗
    expect((env["rng"] as ScriptedRng).consumed).toBe(before + 1296);
});
test("invasion: guaranteed kill + half loot (env2.py:508-547)", () => {
    const env = makeEnv(); env.reset();
    env.pending_spawns[0] = 9999;
    env.known[0 * 36 + 1] = 1;                      // res 用默认 [10,10,10,10]，勿篡改（守恒）
    const actions = new Int32Array(36); actions[0] = 6;
    const targets = new Int32Array(36).fill(-1); targets[0] = 1;
    const { result } = tick(env, actions, targets);
    expect(env.alive[1]).toBe(0); expect(env.death_cause[1]).toBe("invade");
    expect(result.info.invasions).toEqual([[0, 1, false]]);
    expect(env.res[0]).toBeCloseTo(15, 10);          // 10 + 5
    expect(result.info.loot_to[0]).toBeCloseTo(5, 10);
    expect(env.res[1]).toBeCloseTo(5, 10);           // 剩余半具 → 阶段8b 入池
    expect(env.free_pool).toBeCloseTo(115, 10);
    assertConservation(env);
});
test("counter-invade needs no valid target (Q9) → mutual, no loot", () => {
    const env = makeEnv(); env.reset();
    env.known[0 * 36 + 1] = 1; env.res[0] = 10; env.res[1] = 10;
    const actions = new Int32Array(36); actions[0] = 6;
    const targets = new Int32Array(36).fill(-1); targets[0] = 1;
    env.beginTick(actions, targets);                  // 1 收到通知
    const re = actions.slice(); re[1] = 6;            // 反咬——无目标也生效
    const { result } = tick(env, actions, targets, re);
    expect(env.alive[0]).toBe(0); expect(env.alive[1]).toBe(0);
    expect(env.death_cause[0]).toBe("mutual"); expect(env.death_cause[1]).toBe("mutual");
    expect(result.info.invasions).toEqual([[0, 1, true], [1, 0, true]]);
    expect(result.info.loot_to.every((v) => v === 0)).toBe(true);
});
test("victim re-choosing BD cancels the invasion (windup immune, Q4)", () => {
    const env = makeEnv(); env.reset();
    env.known[0 * 36 + 1] = 1; env.tech[1] = 6;
    const actions = new Int32Array(36); actions[0] = 6;
    const targets = new Int32Array(36).fill(-1); targets[0] = 1;
    env.beginTick(actions, targets);
    const re = actions.slice(); re[1] = 5;
    tick(env, actions, targets, re);
    expect(env.alive[1]).toBe(1); expect(env.domain_windup[1]).toBe(1);
});
```

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**（env2.py:452-547）+ 其余用例：
  - **打击**（env2.py:458-496）：`known_alive_d/known_alive_tech/known_alive_tech_n` 三个矩阵（对角 inf/−inf，目标须 known & alive & 非域 & 非风窗）；strike_rows = eff∈{4,8,9} & alive，**升序**逐个：WEAK→argmin(tech)、STRONG→argmax(tech_n)、STRIKE→显式 `_targets[i]` 否则 argmin(d)，显式无效（非 known/死/域/风窗）回退 argmin(d)；`!isfinite(d[i][j]) → continue`（全 inf 时 argmin=0，被此守卫拦下）；护盾：`tech_j ≥ 2·tech_i` → `take = 0.5·max(res_j,0)`，res_j−=take、pool+=take、记 blocked 事件，**不掷骰**；否则 `p_kill = clip(0.55+0.12·(tech_i−tech_j), 0.15, 0.95)`，`killed = rng.uniform() < p_kill`，记 strikes + strike_events；`killed && alive[j] && j∉kills → kills[j]=i`。
  - **置死**（env2.py:498-506）：`kills` 中仍活者 `alive=0; death_cause="strike"`（09-22 修复本体）。
  - **入侵**（env2.py:508-547）：对 `_invaders`（victim→invader）：双方活才继续；`in_domain[victim] || domain_windup[victim] → continue`（重选 BD 生效于此）；`counter = reActions[victim]==INVADE && invader 活 && invader∉invasion_kill`；victim 入 invasion_kill，记 invasions；counter → invader 也入 invasion_kill 并追加 `(victim, invader, true)`；invasion_kill 全体置死；掠夺：killer 活 && victim 死 → `take=0.5·max(res_victim,0)`，res_killer+=take、loot_to[killer]+=take、res_victim 减半（余量待 8b 入池）。death_cause："invade"，mutual 对覆盖 "mutual"。
  - 其余用例：`p_kill 下限 clip 0.15`（Δtech=−4 → 0.07→0.15，fill 0.5>0.15 幸存，事件 "survived"）；`STRIKE 无显式目标打最近已知`；`WEAK/STRONG 平手取先`（两目标同 tech）；`双打击者同一受害者：仅首个入 kills，第二个仍产生事件`；`victim 尸体被后续 blocked 打击扣资源`（顺序忠实：strikes 升序，shield 无 alive 检查）；`invader 本刻先被打死 → 入侵跳过`；`strikes 与 strikes_blocked/strike_events 的完整字段结构`。
- [ ] **Step 4:** Run → PASS（旧用例不回归）。
- [ ] **Step 5: Commit** `feat(engine): resolve strikes + invasions`

### Task 9: resolve() 第三段（观测 + 发展/爆炸 + 流失/饿死 + 尸体结算 + 奖励 + 出生 + done + info 终装）

**Files:** Modify `env.ts`；Test `src/lib/engine/resolve-c.test.ts`

- [ ] **Step 1: 失败测试**（节选）

```ts
test("develop: growth 0.05*(1-tech/1e6), softsign reward 0.01*tech/(1+0.2|tech|)", () => {
    const env = makeEnv(); env.reset();
    env.tech[0] = 6;
    const actions = new Int32Array(36).fill(1);        // 全员 DEVELOP
    const { result } = tick(env, actions);
    expect(env.tech[0]).toBeCloseTo(6 + 0.05 * (1 - 6 / 1e6), 12);
    expect(result.rewards[0]).toBeCloseTo(0.01 * (6 + 0.05 * (1 - 6 / 1e6)) /
        (1 + 0.2 * (6 + 0.05 * (1 - 6 / 1e6))), 12);
});
test("explosion: p=0.01, tech *= U[1.6,2.2], domain ×0.1 prob", () => {
    // 队列对齐：探测矩阵 1296 个 0.5（无探测）→ boom 阵第一个 u=0.005 → 倍率 u=0.5 → 1.9
    const env = makeEnv([...Array(1296).fill(0.5), 0.005, 0.5], 0.5); env.reset();
    env.tech[0] = 10;
    tick(env, new Int32Array(36));
    expect(env.tech[0]).toBeCloseTo(19, 10);                  // 10 × 1.9
});
test("depletion → starvation → corpse settlement (env2.py:573-592)", () => {
    // 队列：探测 1296×0.5 → boom 36×0.5 → 流失阵 u=0.01（命中 slot0）→ loss u=0 → 0.5
    const env = makeEnv([...Array(1296 + 36).fill(0.5), 0.01, 0.0], 0.5); env.reset();
    env.pending_spawns[0] = 9999;                              // 抑制同刻出生
    env.res[0] = 0.3; env.free_pool += 9.7;                   // 篡改守恒补偿
    const { result } = tick(env, new Int32Array(36));
    expect(env.alive[0]).toBe(0); expect(env.death_cause[0]).toBe("starve");
    expect(result.rewards[0]).toBe(-10);                      // 死亡惩罚（发展奖励被排除：dev_alive 排除死者）
    expect(env.res[0]).toBe(0); expect(env.free_pool).toBeCloseTo(120, 10); // 110+9.7+0.3(流失入池)
    assertConservation(env);
});
test("birth: pool-afforded endogenous spawn (env2.py:224-254)", () => {
    const env = makeEnv(); env.reset();                       // pool=110, 预滚 12.5
    const { result } = tick(env, new Int32Array(36));
    expect(env.tech.slice(0, 4)).toEqual(new Float64Array([1, 2, 3, 4]));  // act_tech
    // percentile([1,2,3,4],[25,75]) 线性插值 → [1.75, 3.25]；出生 tech u=fill 0.5 → 2.5
    expect(env.tech[4]).toBeCloseTo(2.5, 12);
    expect(env.res[4]).toBe(12.5);
    expect(env.spawn_tick[4]).toBe(1); expect(env.alive[4]).toBe(1);
    expect(env.birth_log).toEqual([[1, 4, 12.5]]);
    expect(env.free_pool).toBeCloseTo(110 - 12.5, 10);
    expect(result.info.n_births).toBe(1);
    expect(env.pending_spawns.length).toBe(1);                // 新预滚（fill 0.5 → 12.5）
});
test("done: t>=tMax; heat death; resolve after done throws (Review Focus 4)", () => {
    const env = makeEnv(); env.reset();
    env.t = 249;
    const { result } = tick(env, new Int32Array(36));
    expect(result.done).toBe(true);
    expect(() => env.resolve(new Int32Array(36))).toThrow(/done/);
    const env2_ = makeEnv(); env2_.reset();
    env2_.alive.fill(0); env2_.pending_spawns[0] = 9999;      // 池 < 预滚 → 热寂
    const r2 = tick(env2_, new Int32Array(36));
    expect(r2.result.done).toBe(true);
});
```

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**（env2.py:549-628）：
  - **观测**（549-556）：obs_rows = eff==OBSERVE & alive；`j = argmin(known_alive_d[i])`；isfinite 才置 `observed[i,j]=1` 并 `pending_counter.push(i)`（**无目标不曝光**）。
  - **发展/爆炸**（557-571）：`growth = 0.05·(1−tech/1e6)`，域内 ×0.2；`peak_tech` 随活者更新；boom 阵列 `p=0.01`（域内 ×0.1），`u = rng.uniformArray(n)` 恒调用；boom.any → `tech[boom] *= rng.uniformArray(cnt, 1.6, 2.2)`（调用次数=命中数；**仅在 p_explosion>0 时乘**）。
  - **流失/饿死**（573-585）：`deplete = alive & (u=uniformArray(n) < 0.02)`；`loss = uniformArray(cnt, 0.5, 2)`，`loss = min(loss, max(res,0))`，res−=loss、pool+=Σloss；`starved = alive & res≤0` → 置死、cause="starve"、dead_now |= starved。
  - **尸体结算 8b**（587-592）：dead_now 且非活者：pool += max(res,0)，res=0。
  - **奖励**（594-603）：`rewards[dead_now] −= 10`；`dev_alive = eff==DEVELOP & alive` → `+ 0.01·tech/(1+0.2·|tech|)`（softsign_reward_scale=0.01，**develop_reward 不参与**——Q6）。
  - **出生**（605-606 → activatePendingSpawns，env2.py:224-254）：pool ≥ pending[0] 且存在空槽（spawn_tick>1e8 取最小）→ 出生：tech = uniformRange(lo,hi)（lo/hi = 活者 tech 的 P25/P75 线性插值；活者 <2 用出生区间；跨度 <1 时以中点 ±0.5 收拢）；res = pending.shift()；pool −= spawn_res；**再预滚下一个** `uniformRange(5,20)`；spawn_tick=t+1；alive=1；birth_log 追加 `[t+1, slot, spawn_res]`。
  - **done**（610-615）：`t ≥ tMax || (全员死 && pool < pending_spawns[0])`；**done 后再 resolve 抛 `Error("episode done")`**（tick 前检查 `_actions===null` 之外的 guard：加 `this._done` 标志）。
  - **info 终装**（616-627）：13 字段全数填装（detections/strikes/invasions/loot_to(Float64Array n)/died_this_tick `[[v, cause]]`/strikes_blocked/strike_events/free_pool/res_conservation_residual(=res_total−Σres−pool)/n_births/n_alive/in_domain/counter_detections）。
  - 其余用例：`观测获知 tech/res 精确（observed 置位）+ 下刻反曝光链`；`域内发展 ×0.2`；`invaded victim 余量入池（Task 8 的 pool 断言补全）`；`死当刻发展不计发展奖励但计死亡惩罚`；`Q11：死亡槽不复用——slot 4 出生后死亡，下次出生用 slot 5`。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(engine): resolve stages 4-10 complete`

### Task 10: obs()（38 维）

**Files:** Modify `env.ts`（完整实现 `obs()`，替换 Task 4 占位）；Test `src/lib/engine/obs.test.ts`

- [ ] **Step 1: 失败测试**（布局断言逐段）

```ts
const LOG_REF = Math.log1p(50);
function row(env, i) { return env.obs().slice(i * 38, (i + 1) * 38); }

test("obs layout: scalars + onehot + near blocks; float32 (env2.py:289-331)", () => {
    const env = makeEnv(); env.reset();                    // techs [1,2,3,4], res 10, 全坐标 (2,2)
    const r0 = row(env, 0);
    expect(r0[0]).toBe(Math.fround(Math.log1p(1) / LOG_REF));
    expect(r0[1]).toBeCloseTo(10 / 20, 12);
    expect(r0[2]).toBeCloseTo(0 / 35, 12);                // 无已知
    expect(r0[3]).toBeCloseTo(4 / 36, 12);
    expect(r0[4]).toBeCloseTo(0 / 250, 12);
    expect(r0[5]).toBe(0); expect(r0[6]).toBe(0);
    expect(r0[7]).toBe(1);                                 // last_action=SILENT one-hot
    expect(r0.slice(8, 17).every((v) => v === 0)).toBe(true);
    // 无已知 → 近邻块全为掩蔽零向量：(Δx=0, Δy=0, d=0, tech=-1, res=-1/20, public=0, in_domain=0)
    expect(r0[17]).toBeCloseTo(0, 12); expect(r0[20]).toBeCloseTo(0, 12);
    expect(r0[23]).toBe(-1); expect(r0[24]).toBeCloseTo(-1 / 20, 12);      // 未观测情报
    expect(r0[25]).toBe(0); expect(r0[26]).toBe(0);                        // public、in_domain(Q3 恒0)
});
test("observed intel fills tech/res; torus wrap delta (env2.py:314-318)", () => {
    const env = makeEnv(); env.reset();
    env.pos[2 * 2] = 98;                                    // 2 号 x=98（自身 x=2 → 环面 Δ = -4）
    env.known[0 * 36 + 2] = 1; env.observed[0 * 36 + 2] = 1; env.tech[2] = 7; env.res[2] = 14;
    const r0 = row(env, 0);
    expect(r0[17]).toBeCloseTo(-4 / 50, 12);                // Δx 环面回绕
    expect(r0[23]).toBe(Math.fround(Math.log1p(7) / LOG_REF));
    expect(r0[24]).toBeCloseTo(14 / 20, 12);
});
test("dead/unborn rows zeroed; domain target excluded from near blocks (Q3)", () => {
    const env = makeEnv(); env.reset();
    env.known[0 * 36 + 1] = 1; env.in_domain[1] = 1;         // 唯一已知者在域 → 不入近邻块（整块掩蔽零）
    const r0 = row(env, 0);
    expect(r0[17]).toBe(0); expect(r0[20]).toBe(0);
    expect(r0[23]).toBe(-1); expect(r0[24]).toBeCloseTo(-0.05, 12);
    expect(row(env, 5).every((v) => v === 0)).toBe(true);    // 未出生行
    env.alive[1] = 0;
    expect(row(env, 1).every((v) => v === 0)).toBe(true);    // 死亡行
});
```

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**（env2.py:289-331 逐行）：7 标量（known-alive 计数含 Q2 的 known[j,j]——照抄 `(known & alive).sum/(n−1)`）；one-hot；近邻：`big = dist≤30 ? dist : inf`，对角 inf，非 known-alive 置 inf；**稳定排序**取前 3（Argsort 平手序差异无害——掩蔽行输出恒等，规格 §3.3）；known_pair = known & alive & 非域；dmask；near_tech/near_res 条件情报；`Δ = pos[order]−pos[i]` 环面回绕 `Δ −= world·round(Δ/world)`；末段拼装后**逐元素 `Math.fround`**；`!alive` 行整行清零。crowd 变量为死代码，不移植。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(engine): 38-dim obs`

### Task 11: Q1-Q12 综合锁 + info parity + 守恒辅助

**Files:** Test `src/lib/engine/quirks.test.ts`、`src/lib/engine/info-parity.test.ts`；Modify `test-helpers.ts`（若需）

- [ ] **Step 1:** 写 `quirks.test.ts`——12 用例各注释锚定 `docs/env-model-v23.md §0`；已覆盖的引用前任务（Q1=reset.test、Q4/9/12=resolve-b.test、Q5/6=resolve-c.test），本文件补齐未单独覆盖者：
  - **Q2**：广播结算后 `known[j,j]==1`（含广播者自知计数进 obs 标量 2）。
  - **Q3**：近邻块 in_domain 特征恒 0（obs.test 已有，此处加"目标已知但入域 → 从近邻块剔除"断言）。
  - **Q7**：`exists` getter 移植且不被 resolve 引用（行为 parity：活且 t≥spawn_tick）。
  - **Q11**：出生槽一次性——slot 4 出生→死亡→下次出生取 slot 5（spawn_tick 不复活）。
  - **Q1**：第二次 reset 时 prevPos 参与拒绝环（构造 stale-pos 场景：reset 两次，第二次队列提供 d<12 的位置对，断言触发一次 re-roll——队列值精确控制）。
  - **Q5**：残差是 info 字段：构造 `pool + Σres + 尸体` 正常情形断言 `|res_conservation_residual|≤1e-6`；**不因非零抛错**（无 assert 语义）。
- [ ] **Step 2:** 写 `info-parity.test.ts`——对一次多事件刻（构造：探测+打击被挡+入侵+出生同刻），逐字段断言 info 形状与值类型（`detections: number[][]`、`strike_events` 六元组、`loot_to` 长度 36、`n_alive` 与 alive 计数一致等），与 env2.py:616-627 字典一一对应（注释行号）。
- [ ] **Step 3:** Run `bun test src/lib/engine` → 全 PASS。
- [ ] **Step 4: Commit** `test(engine): quirk lock Q1-Q12 + info parity`

### Task 12: strike-fix.test.ts（验收门 1）

**Files:** Test `src/lib/engine/strike-fix.test.ts`

- [ ] **Step 1:** 写测试（镜像 test_strike_fix.py 的 10 种子 × 三断言；击杀掷骰 rigged）

```ts
import { expect, test } from "bun:test";
import { makeEnv } from "./test-helpers";
import { assertConservation } from "./snapshot";

function forceStrike(seed: number, techI: number, techJ: number, killRoll: number) {
    // 队列对齐：构造 81 个 0 → 探测矩阵 1296 个 0（p_det=0，不消耗判定）→ 击杀掷骰 killRoll
    const env = makeEnv([...Array(81 + 1296).fill(0), killRoll], 0.5);
    env.reset();                                       // seed 为名义参数（结构与 test_strike_fix 对齐；断言不依赖随机性）
    const i = 0, j = 1;
    env.known[i * 36 + j] = 1; env.tech[i] = techI; env.tech[j] = techJ;
    const actions = new Int32Array(36); actions[i] = 4;
    const targets = new Int32Array(36).fill(-1); targets[i] = j;
    env.beginTick(actions, targets);
    const { info } = { info: env.resolve(actions).info };
    return { env, j, ev: info.strike_events.filter((e) => e[0] === i), info };
}
for (let s = 0; s < 10; s++) {
    test(`seed ${s}: kill + cause + conservation`, () => {
        const { env, j, ev, info } = forceStrike(100 + s, 20.0, 1.0, 0.94);   // p=0.95
        expect(env.alive[j]).toBe(0);
        expect(env.death_cause[j]).toBe("strike");
        expect(ev.length).toBeGreaterThan(0); expect(ev[0][2]).toBe("killed");
        expect(Math.abs(info.res_conservation_residual)).toBeLessThanOrEqual(1e-6);
        assertConservation(env);
    });
    test(`seed ${s}: shield block at ratio >= 2`, () => {
        const { env, j, ev } = forceStrike(200 + s, 10.0, 25.0, 0.94);        // 25 >= 2×10，护盾先于掷骰
        expect(env.alive[j]).toBe(1);
        expect(ev.length).toBeGreaterThan(0); expect(ev[0][2]).toBe("blocked");
    });
}
test("kill roll above p survives (rigged 0.96 > 0.95)", () => {
    const { env, j, ev } = forceStrike(300, 20.0, 1.0, 0.96);
    expect(env.alive[j]).toBe(1); expect(ev[0][2]).toBe("survived");
});
```

- [ ] **Step 2:** Run → 全 PASS（引擎已实现；若有失败=引擎 bug，先修引擎再回来）。
- [ ] **Step 3: Commit** `test(engine): test_strike_fix equivalence (10 seeds)`

---

## M2：金标准录制 + 回放

### Task 13: scripts/golden/record_golden.py + 轨迹生成

**Files:** Create `scripts/golden/record_golden.py`、`scripts/golden/README.md`（运行说明）；Output `src/lib/engine/testdata/*.json.gz` + `stats.json`

**Interfaces:** Produces 轨迹文件（规格 §4.1 格式）：`{ meta, reset: {state, obs}, ticks: [{actions, targets, invaded, reObs, reActions, post: {state, obs, info, rewards, done}}], rngLog: [{m, args, v}] }`；`stats.json = { episodes, poolPattern, meanAliveFrac, actionFreqs, killsMean, tolerance }`。

- [ ] **Step 1: 写脚本**（核心结构；`_enc` 标量存 float、数组存 `"b64:f64:<base64>"` / obs 存 `"b64:f32:<base64>"`）

```python
#!/usr/bin/env python3
"""Record golden traces: every env RNG call (uniform/choice) + per-tick full state.
Dev-time only. PYTHONUTF8=1 python3 scripts/golden/record_golden.py
Read-only reference: experiment/experiment (via sys.path)."""
import base64, gzip, json, os, sys
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "experiment", "experiment"))
import data2 as dm
from env2 import A_INVADE, A_STRIKE
from model import DQNAgent
from train2 import heuristic_action
from stage_b import build_pattern

def _enc(v):
    if isinstance(v, np.ndarray):
        tag = "b64:f32" if v.dtype == np.float32 else "b64:f64"
        return tag + ":" + base64.b64encode(np.ascontiguousarray(v).tobytes()).decode()
    return float(v)

class RecordingRng:
    """Wraps a numpy Generator; env2 only calls uniform()/uniform(low,high[,size])/choice(a)."""
    def __init__(self, inner):
        self.inner, self.log = inner, []
    def uniform(self, low=0.0, high=1.0, size=None):
        v = self.inner.uniform(low, high, size=size)
        self.log.append({"m": "uniform", "args": [float(low), float(high), None if size is None else (list(size) if isinstance(size, tuple) else int(size))], "v": _enc(v)})
        return v
    def choice(self, a):
        v = self.inner.choice(a)
        self.log.append({"m": "choice", "args": [[int(x) for x in a]], "v": int(v)})
        return v

def snapshot(env):
    return {"t": env.t, "pos": env.pos.tolist(), "tech": env.tech.tolist(), "res": env.res.tolist(),
            "alive": env.alive.astype(int).tolist(), "known": env.known.astype(int).tolist(),
            "observed": env.observed.astype(int).tolist(), "public": env.public.astype(int).tolist(),
            "in_domain": env.in_domain.astype(int).tolist(),
            "domain_windup": env.domain_windup.astype(int).tolist(),
            "pending_reveal": [list(x) for x in env.pending_reveal],
            "pending_counter": list(env.pending_counter),
            "last_action": env.last_action.tolist(),
            "first_detect_tick": env.first_detect_tick.tolist(),
            "free_pool": env.free_pool, "pending_spawns": list(env.pending_spawns),
            "birth_log": [list(x) for x in env.birth_log], "death_cause": list(env.death_cause),
            "spawn_tick": env.spawn_tick.tolist(), "spawn_tech": env.spawn_tech.tolist(),
            "spawn_res": env.spawn_res.tolist(), "peak_tech": env.peak_tech.tolist(),
            "spawn_total_res": float(env.res.sum() + env.free_pool)}

def run_trace(cfg, seed, kinds, agent_arms, script=None, max_ticks=None):
    env = dm.make_env(cfg, seed=seed)
    env.rng = RecordingRng(np.random.default_rng(seed))
    rngs = [np.random.default_rng(seed * 100 + i) for i in range(env.n)]
    agents = {arm: _load_agent(cfg, arm) for arm in set(agent_arms.values())} if agent_arms else {}
    obs, valid = env.reset()
    trace = {"meta": {"seed": seed, "kinds": kinds, "agentArms": agent_arms,
                      "driver": "scripted" if script else "stage_b"},
             "reset": {"state": snapshot(env), "obs": _enc(obs)},
             "ticks": [], "rngLog": env.rng.log}
    done, t = False, 0
    while not done and (max_ticks is None or t < max_ticks):
        actions = np.zeros(env.n, dtype=np.int64)
        if script:   # scripted episode: fn(env, t) -> (actions, targets, reActions)
            actions, targets, forced_re = script(env, t)
        else:        # stage_b driver (stage_b.py:36-61)
            for i in range(env.n):
                if not env.alive[i]:
                    continue
                k = kinds[i]
                if k == "learner":
                    pass  # 批量在下方
                else:
                    actions[i] = heuristic_action(k, obs, valid, env, i, rngs[i], env.t)
            live_learn = [i for i in range(env.n) if env.alive[i] and kinds[i] == "learner"]
            if live_learn:
                li = np.array(live_learn)
                arms = [agent_arms[i] for i in li]
                actions[li] = agents[arms[0]].act(obs[li], valid[li], 0.05)  # 单臂批量（多臂场景逐臂分组）
            tmask = env.select_targets(actions)
            targets = np.full(env.n, -1, dtype=np.int64)
            for i in np.where((actions == A_INVADE) | (actions == A_STRIKE))[0]:
                cand = np.where(tmask[i])[0]
                if cand.size:
                    k = kinds[i]
                    if k == "df":
                        from train2 import pick_target
                        targets[i] = pick_target(tmask[i], k, env.tech, actions[i])
                    else:
                        targets[i] = int(rngs[i].choice(cand))
        mark = len(env.rng.log)
        invaded = env.begin_tick(actions, targets)
        re_obs = env._obs() if invaded else None
        re = actions.copy()
        if script and forced_re is not None:
            for v, a in forced_re.items():
                re[v] = a
        elif invaded:
            re_valid = env._valid()
            for v in invaded:
                k = kinds[v]
                if k == "learner":
                    re[v] = agents[agent_arms[v]].act(re_obs[v:v+1], re_valid[v:v+1], 0.05)[0]
                else:
                    re[v] = heuristic_action(k, re_obs, re_valid, env, v, rngs[v], env.t)
        nobs, nvalid, r, alive, done, info, dead = env.resolve(re)
        trace["ticks"].append({"actions": actions.tolist(), "targets": targets.tolist(),
                               "invaded": list(invaded),
                               "reObs": _enc(re_obs) if re_obs is not None else None,
                               "reActions": re.tolist(),
                               "post": {"state": snapshot(env), "obs": _enc(nobs),
                                        "info": _jsonable(info), "rewards": r.tolist(),
                                        "done": bool(done)}})
        obs, valid = nobs, nvalid
        t += 1
    return trace, env
```

`_jsonable(info)`：元组转列表、`loot_to` 转 list、`died_this_tick` 保持 `[[v, cause]]`。
`_load_agent`：`DQNAgent(obs_dim=38, n_actions=10, hidden=[64,64], lr=6e-4, gamma=0.995, batch_size=128, replay_size=150000, target_sync=2000, seed=1001)` + `agent.load(npz 路径)`（不训练）。

**Step 1 续：main() 轨迹集**：
1. `trace-main-s1`（完整 250 刻）：seed=41001，kinds=build_pattern(36)，agentArms：全部 learner→`main`；无 max_ticks。
2. `trace-main-s2`：seed=41002，kinds 全 pacifist（无 DQN——省加载，纯静默发展向轨迹，覆盖饿死/爆炸/出生长尾）。
3. `trace-tgt-mutual`（≤8 刻）：seed=41003，kinds 全 pacifist，script：t=1 时 slot0 INVADE slot1（先 `env.known[0,1]=True`），slot1 强制反咬 → 断言双方 mutual（脚本内校验后写轨迹）。
4. `trace-tgt-shield`：t=1 构造 tech 8 vs 20、known、STRIKE → blocked。
5. `trace-tgt-windup`：构造 BD 风窗 + 被打击/被入侵 → 免疫。
6. `trace-tgt-heat`：全 pacifist + `env.res.fill(0.4)` 开局（出生后耗尽）→ 热寂 done（max_ticks 250）。
   每 trace 写 `src/lib/engine/testdata/<name>.json.gz`（`gzip.compress(json.dumps(trace).encode())`）。
   另：`stats.json`——跑 30 局 presets-only（kinds=build_pattern 但 learner→random，无 DQN），记录 `meanAliveFrac`（alive_ticks/(t_max−spawn_tick) 口径同 stage_b.py:116）、`actionFreqs`、`killsMean`。

- [ ] **Step 2: 运行并自检**：`PYTHONUTF8=1 python3 scripts/golden/record_golden.py`
  Expected: 6 个 .json.gz + stats.json；打印每轨迹 tick 数与 rngLog 长度；grep 校验 `git -C experiment status` 干净（零改动）。
- [ ] **Step 3: Commit** `test(golden): record 6 traces + stats`

### Task 14: golden-replay.test.ts + testdata README（验收门 3、2、4）

**Files:** Create `src/lib/engine/testdata-io.ts`、`src/lib/engine/golden-replay.test.ts`、`src/lib/engine/stat-equivalence.test.ts`、`src/lib/engine/testdata/README.md`；Modify `rng.ts`（ReplayRng 完整接线）

**Interfaces:** Produces: `loadTrace(name: string): Trace`（gunzip+JSON）、`decodeB64(tagged: string): Float64Array | Float32Array`、ReplayRng 完整实现（消费 `TraceDraw[]`，方法+args 断言）。

- [ ] **Step 1: testdata-io + ReplayRng 完整实现**（node:zlib gunzipSync；Buffer base64；ReplayRng：`uniform()` 校验 `m==="uniform" && args[2]===null`；`uniformArray(size, lo, hi)` 校验 lo/hi 及 `args[2]===size`（矩阵 [r,c] 校验乘积）；`choice` 校验候选集逐元素；返回解码值；`assertExhausted()` 在测试末尾调用——**消耗序断言即 Review Focus 1**）。
- [ ] **Step 2: 写回放测试**（测试内先定义 `decodeF32(tagged)`：`new Float32Array(decodeB64(tagged).buffer)`（testdata-io 的 `decodeB64` 返回 Uint8Array）；`expectInfoEqual(actual, recorded)`：13 字段逐一 `toEqual`，其中 `loot_to` 用 `[...actual.loot_to]` 数组化后比较、浮点字段用 `toBeCloseTo(x, 10)`）

```ts
// src/lib/engine/golden-replay.test.ts（骨架）
import { expect, test } from "bun:test";
import { loadTrace } from "./testdata-io";
import { DarkForestEnv2 } from "./env";
import { ReplayRng } from "./rng";
import { snapshot, compareState, assertConservation } from "./snapshot";
import { V23_CONFIG } from "./config";

for (const name of ["trace-main-s1", "trace-main-s2", "trace-tgt-mutual",
                    "trace-tgt-shield", "trace-tgt-windup", "trace-tgt-heat"]) {
    test(`golden replay: ${name}`, () => {
        const tr = loadTrace(name);
        const rng = new ReplayRng(tr.rngLog);
        const env = new DarkForestEnv2(V23_CONFIG, rng);
        env.reset();
        expect(compareState(snapshot(env), tr.reset.state)).toBeNull();
        expect(env.obs()).toEqual(decodeF32(tr.reset.obs));          // Float32 逐元素
        for (let k = 0; k < tr.ticks.length; k++) {
            const tk = tr.ticks[k];
            const invaded = env.beginTick(Int32Array.from(tk.actions), Int32Array.from(tk.targets));
            expect(invaded).toEqual(tk.invaded);
            if (tk.reObs !== null) expect(env.obs()).toEqual(decodeF32(tk.reObs));
            const r = env.resolve(Int32Array.from(tk.reActions));
            const diff = compareState(snapshot(env), tk.post.state, 1e-12);
            expect(diff === null ? "" : `tick ${k}: ${diff}`).toBe("");
            expect(env.obs()).toEqual(decodeF32(tk.post.obs));
            expect(r.done).toBe(tk.post.done);
            expect(r.rewards).toEqual(Float64Array.from(tk.post.rewards));  // 精确
            expectInfoEqual(r.info, tk.post.info);                  // 逐字段（loot_to 数组化后比较）
            assertConservation(env);
            if (r.done) break;
        }
        rng.assertExhausted();
    });
}
```

- [ ] **Step 3: 跑测并迭代**：`bun test src/lib/engine/golden-replay.test.ts`。预期首跑 FAIL——逐差异修**引擎**（不是修测试/轨迹），直至全绿；每轮 diff 输出即定位线索（消耗序失配→ReplayRng 抛错带 args）。**此任务即一致性验收门，全绿前不得开始 M3**（CLAUDE.md 硬规定）。
- [ ] **Step 4: stat-equivalence.test.ts（第二口径）**：内联迷你驱动器（kinds 循环 [random,df,pacifist]，同 stats.json 口径）跑 10 局（seed 50001+i）；断言：每刻守恒全程成立（硬）；meanAliveFrac 落在 stats.json±0.10、actionFreqs ±0.05（带宽披露于 README）。
- [ ] **Step 5: testdata/README.md 口径披露**（规格 §4.2 全文落地）：不移植 PCG64 的原因；精确相等+1e-12 容差（np.sum 成对求和）；obs Float32 逐位断言的论证（掩蔽行零向量恒等）；stat-equivalence 带宽与单种子披露；strike-fix rigged-Rng 偏离声明；再生成命令。
- [ ] **Step 6: 全量跑** `bun test && bun run check` → 全绿。
- [ ] **Step 7: Commit** `test(golden): record-replay gate green`

---

## M3：对手层

### Task 15: 模型资产管线（npz → JSON）+ 前向奇偶数据 + 缓存头

**Files:** Create `scripts/golden/convert_models.py`、`scripts/golden/record_dqn_outputs.py`；Output `public/models/<arm>.json`（12 个）、`src/lib/engine/testdata/dqn-outputs.json`；Modify `next.config.ts`

**Interfaces:** Produces: `ModelWeights` JSON 形状 `{ arm, source, updates, shapes, W0: number[38][64], b0: number[64], W1: number[64][64], b1: number[64], W2: number[64][10], b2: number[10] }`；`dqn-outputs.json = { arms: [{ arm, inputs: number[10][38], outputs: number[10][10], validMasks?: 无 }] }`。

- [ ] **Step 1: convert_models.py**

```python
#!/usr/bin/env python3
"""npz -> public/models/<arm>.json. Dev-time only (PYTHONUTF8=1 not needed, pure ascii)."""
import json, os, sys
import numpy as np
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAIN = os.path.join(REPO, "experiment/runs/v23_fix/seed42_main/checkpoint.npz")
ARMS = {"main": MAIN}
for arm in ["base_control","budget100","budget200","gamma099","gamma0999","lr3e4","lr12e3",
            "scale005","scale02","shield025","shield075"]:
    ARMS[arm] = os.path.join(REPO, f"experiment/runs/v23_fix_sweep_arms/{arm}/run/seed42_main/checkpoint.npz")
OUT = os.path.join(REPO, "public", "models")
os.makedirs(OUT, exist_ok=True)
for arm, path in ARMS.items():
    d = np.load(path, allow_pickle=False)          # npz = 无压缩 ZIP + .npy v1.0 LE float64
    w = {"arm": arm, "source": os.path.relpath(path, REPO).replace("\\", "/"),
         "updates": int(d["updates"]),
         "shapes": {"W0": [38,64], "b0": [64], "W1": [64,64], "b1": [64], "W2": [64,10], "b2": [10]}}
    for k in ["W0","b0","W1","b1","W2","b2"]:
        w[k] = d[f"online__{k}"].tolist()          # Python repr 往返 IEEE 精确（规格 §5.1）
    with open(os.path.join(OUT, f"{arm}.json"), "w") as f:
        json.dump(w, f, separators=(",", ":"))
    print(arm, "->", len(json.dumps(w)), "bytes")
```

- [ ] **Step 2: record_dqn_outputs.py**——每臂 `DQNAgent(...).load(npz)`（同 Task 13 `_load_agent`），`rng = np.random.default_rng(777)`，`inputs = rng.uniform(-1, 1, size=(10, 38)).astype(np.float32)`（obs 是 float32，agent 内部升 float64），`outputs, _ = agent.online.forward(inputs.astype(np.float64))`；写单文件 `src/lib/engine/testdata/dqn-outputs.json`：`{"arms": [{"arm", "inputs": inputs.tolist(), "outputs": outputs.tolist()}]}`。
- [ ] **Step 3: 运行 + 验证**：两个脚本各跑一遍；抽查 `bun -e 'const w=require("./public/models/main.json"); console.log(w.W0.length, w.W0[0].length, w.updates, w.source)'` → `38 64 149985 experiment/runs/v23_fix/seed42_main/checkpoint.npz`；`git -C experiment status --porcelain` 为空。
- [ ] **Step 4: next.config.ts 缓存头**：

```ts
const nextConfig: NextConfig = {
    reactCompiler: true,
    async headers() {
        return [{ source: "/models/:path*",
                  headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
    },
};
```

- [ ] **Step 5:** `bun run build` 绿后 Commit `feat(opponents): model json pipeline + immutable cache`

### Task 16: catalog.ts

**Files:** Create `src/lib/opponents/catalog.ts`；Test `src/lib/opponents/catalog.test.ts`

**Interfaces:** Produces: `export const PRESET_IDS = ["random","df","pacifist"] as const;`、`export interface ModelEntry { id: string; file: string; survival: number | null; labelKey: MessageKey; }`、`export const MODEL_CATALOG: ModelEntry[]`（12 项：main 0.627 为训练主口径；11 臂用 2×40ep 相对口径值，见 ai-opponents.md）、`export function isOpponentId(x: string): boolean`。

- [ ] **Step 1: 失败测试**——12 模型、id 唯一、file 与 public/models 对应（`existsSync("public/models/"+file)` 逐一 true）、3 预设、`isOpponentId` 真假表。
- [ ] **Step 2/3/4:** 实现（survival 数值从 `docs/ai-opponents.md` 抄录：main 0.627；base_control 0.669 / shield025 0.775 / shield075 0.613 / scale005 0.747 / scale02 0.612 / budget100 0.683 / budget200 0.707 / lr3e4 0.618 / lr12e3 0.522 / gamma099 0.753 / gamma0999 0.580）→ 跑绿。
- [ ] **Step 5: Commit** `feat(opponents): catalog`

### Task 17: dqn.ts + 前向奇偶测试

**Files:** Create `src/lib/opponents/dqn.ts`；Test `src/lib/opponents/dqn.test.ts`

**Interfaces:** Consumes `Rng`（engine/rng）。Produces: `interface ModelWeights`（TS 型 = JSON 形状）、`loadModel(id): Promise<ModelWeights>`（fetch `/models/${id}.json`，非 ok 抛 `Error("model ${id}: HTTP …")`）、`forward(w, x: Float64Array): Float64Array`（38→64→64→10，ReLU×2、线性输出）、`actBatch(w, obsRows: Float32Array[], validRows: Uint8Array[], eps: number, rng: Rng): number[]`。

- [ ] **Step 1: 失败测试**

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { forward, actBatch, type ModelWeights } from "./dqn";
import { ScriptedRng } from "@/lib/engine/rng";
const outs = JSON.parse(readFileSync("src/lib/engine/testdata/dqn-outputs.json", "utf8"));

test("dqn parity vs numpy forward (all 12 arms, |ΔQ|<=1e-9)", () => {
    for (const rec of outs.arms) {
        const w = JSON.parse(readFileSync(`public/models/${rec.arm}.json`, "utf8")) as ModelWeights;
        for (let r = 0; r < 10; r++) {
            const q = forward(w, Float64Array.from(rec.inputs[r]));
            for (let a = 0; a < 10; a++)
                expect(Math.abs(q[a] - rec.outputs[r][a])).toBeLessThanOrEqual(1e-9);
        }
    }
});
test("actBatch: masked argmax + epsilon explore consumption order (model.py:146-156)", () => {
    const w = JSON.parse(readFileSync("public/models/main.json", "utf8")) as ModelWeights;
    const x = Float32Array.from(outs.arms[0].inputs[0]);
    const allValid = new Uint8Array(10).fill(1);
    expect(actBatch(w, [x], [allValid], 0, new ScriptedRng([], 0.5))).toEqual([expectedArgmax]);  // 执行时以实际输出填
    // ε=1 且队列先给 0.3（<1 探索）再给合法集选择 3 → 选 3；消耗序：先 uniformArray(B) 再逐行 choice
    const halfValid = new Uint8Array([1,0,1,0,1,0,1,0,1,0]);
    const r = new ScriptedRng([0.3, 3], 0.5);
    expect(actBatch(w, [x], [halfValid], 1, r)).toEqual([3]);
    expect(r.consumed).toBe(2);
});
```

（注：容差 **1e-9** 是对规格 1e-12 的明示放宽并写入 README：numpy BLAS 的分块求和序与 TS 朴素循环不可逐位一致，而任何**转换错误**（键错/序错/精度截断）造成的偏差 ≥1e-6 量级，1e-9 足以锁死转换完整性；argmax 一致性由逐行比较隐含覆盖。）

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**——`forward`：`h1[c]=Σr x[r]·W0[r][c]+b0[c]` 后 `max(·,0)`；同构 h2、out（零值行跳过优化安全：+0 不改 IEEE 和）。`actBatch`：**先** `rng.uniformArray(B)` 一次（同 model.py:151），逐行 forward→非法置 −∞→argmax 平手取先；`explore[i]<ε` 时 `rng.choice(合法下标)`（合法集至少含 SILENT，best 不会为 −1）。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(opponents): dqn inference + parity`

### Task 18: presets.ts

**Files:** Create `src/lib/opponents/presets.ts`；Test `src/lib/opponents/presets.test.ts`

**Interfaces:** Produces: `type PresetKind = "random" | "df" | "pacifist"`、`heuristicAction(kind, valid: Uint8Array(10), rng: Rng): number`、`pickTarget(kind: "df" | "random" | "model", cand: number[], tech: Float64Array, action: number, rng: Rng): number`（stage_b 口径：df 专用分支，其余均匀）。

- [ ] **Step 1: 失败测试**（ScriptedRng 值直控）：
  - `random`：valid=[SILENT,DEVELOP] → choice 值 1 → 选 1；合法集即候选集。
  - `df` 顺序：STRIKE 合法 → 选 4（不耗 rng）；STRIKE 禁、OBSERVE 合法、u=0.2<0.3 → 选 7；u=0.9 → 落 DEVELOP/SILENT 分支（u=0.5<0.6 → 1）；STRIKE/OBSERVE 皆禁 → u=0.7 → SILENT。
  - `pacifist`：u=0.3 → 1；u=0.9 → 0。
  - `pickTarget`：df+INVADE → 候选 tech 最小者（平手取先）；df+STRIKE → 最大者；random/model → rng.choice；Q9 语境无关（目标二选仅在候选非空时调用）。
- [ ] **Step 2/3/4:** 实现（train2.py:40-52 + stage_b.py:48-52 逐行；**不移植 pick_target 的死代码分支**）→ 绿。
- [ ] **Step 5: Commit** `feat(opponents): preset strategies (stage_b caliber)`

---

## M4：会话层 + UI 接线

### Task 19: solo/match.ts 会话状态机

**Files:** Create `src/lib/solo/match.ts`；Test `src/lib/solo/match.test.ts`

**Interfaces:** Consumes engine 全部 + opponents。Produces:
```ts
export type Phase = "queued" | "awaiting-action" | "awaiting-rechoice" | "ended";
export interface SoloMatchHooks { envRng?: Rng; presetRng?: Rng; modelRng?: (arm: string) => Rng; }
export class SoloMatch {
    constructor(seed: number, opponentIds: string[], weights: Map<string, ModelWeights>, hooks?: SoloMatchHooks);
    readonly env: DarkForestEnv2;      // 公开（测试接缝；UI 只经 view 消费）
    readonly opponentIds: string[];
    phase: Phase; playerSlot: number | null;
    start(): void;                    // 排队幽灵期：自动逐刻直至玩家出生或 done
    submitAction(action: number, target: number): void;   // awaiting-action
    submitRechoice(action: number): void;                  // awaiting-rechoice（反咬=6/黑域=5/取消=保持原动作）
    getPendingInvader(): number | null;
    stats(): { kills: number; loot: number };              // 玩家自身行为结果（规格 §6.2）
    getEnd(): EndView["end"];                              // null | dead | won | unborn
}
```
座位分配（规格 §6.1，**固定约定**）：初始 4 席 = 对手光标 0..3（`opponentIds[cursor++ % len]`）；**玩家 = 出生序 4**（首个内生出生，出生前为幽灵排队态）；此后每次内生出生继续 `cursor++ % len` 循环。对手实例在 `reset()` 与每次 `resolve()` 后按 `env.birth_log` 增量登记（slot→id；slot 永不复用，Q11）。
随机流约定（写进文件头注释）：env=`seedOf(S,"env")`；**全部预设决策（一选/重选/均匀目标）共享一条流** `seedOf(S,"session")`（stage_b.py:45-61 口径——注意 train2 是 per-slot 流，以 stage_b 为准）；每模型实例一条流 `seedOf(S,"model:"+arm)`（批量 act 语义同 train2.py:55-64：先 `uniformArray(B)` 判探索、再逐行 choice；目标均匀选取也用模型流，同 stage_b.py:52）。

- [ ] **Step 1: 失败测试**（用 hooks 注入 ScriptedRng；env 可直接篡改做场景接缝）：

```ts
// src/lib/solo/match.test.ts 之骨架用例
test("start: queued ghost ticks until player birth (ordinal 4), then awaiting-action", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), {});
    m.start();
    expect(m.playerSlot).toBe(4); expect(m.env.alive[4]).toBe(1);
    expect(m.phase).toBe("awaiting-action");
});
test("submitAction guards: wrong phase throws; invalid action throws; valid silent advances one tick", () => {
    const m = new SoloMatch(7, ["pacifist"], new Map(), {}); m.start();
    const t0 = m.env.t;
    expect(() => m.submitAction(4, -1)).toThrow();          // tech 门不足/无已知 → 非法
    m.submitAction(0, -1);
    expect(m.env.t).toBe(t0 + 1); expect(m.phase).toBe("awaiting-action");
    expect(m.phase === "ended" ? () => m.submitAction(0, -1) : null).toBeTruthy; // 占位见下
    const m2 = new SoloMatch(7, ["pacifist"], new Map(), {}); m2.start();
    m2.env.alive.fill(0); m2.env.pending_spawns[0] = 9999;  // 接缝：强制热寂
    m2.start();                                             // start 幂等继续
    expect(m2.phase).toBe("ended");
    expect(() => m2.submitAction(0, -1)).toThrow(/ended/);  // Review Focus 4
});
```
（第一用例的 `expect(...).toBeTruthy` 占位行删去——ended 守卫由 m2 用例覆盖。）

其余用例（Step 1 一并写）：
- **玩家被入侵模态链**：注入 envRng/presetRng 使某 AI 在玩家出生后探测到玩家并 INVADE（ScriptedRng 队列精确控制 choice 序）；断言 `phase==="awaiting-rechoice"`、`getPendingInvader()` = 入侵者 slot；`submitRechoice(6)` → resolve → 双死 → `getEnd()` = `{kind:"dead", cause:"mutual", …}`；`stats().kills` 不计互毁。
- **重选黑域取消入侵**：`submitRechoice(5)` → 玩家 alive=1、windup=1。
- **取消 = 保持原动作**：`submitRechoice(原动作)` → resolve 正常。
- **won/unborn 终态**：篡改 `env.t=249` 后静默一刻 → won（`nAlive` = info.n_alive）；全灭+池 < 预滚 → unborn。
- **玩家死亡终态**：stats().kills 从 info 累计（自身 strike killed + invade 非互毁）、loot = Σloot_to[player]。

- [ ] **Step 2:** Run → FAIL。
- [ ] **Step 3: 实现**（结构照 Task 13 驱动环逐段平移 + 玩家特例）：
  - `runTick(playerAction)`: AI 一选（预设逐席升序共享流；模型按臂分组升序批量 actBatch）；玩家动作合法性校验（`env.valid()` 行）后写入；目标二选（df→pickTarget("df")、random→presetRng.choice、model→模型流 choice、**玩家 STRIKE 允许 target=-1（最近兜底），INVADE target 必须在候选行内否则抛错**）；`beginTick` → 受入侵 AI 立即按各自逻辑重选 → 若玩家 ∈ invaded：存 `pending {re}` 置 phase=awaiting-rechoice 并 return；否则 `finishTick(re)`。
  - `finishTick(re)`: `resolve` → `assignBirths()`（含玩家出生→playerSlot、phase=awaiting-action）→ stats 累计 → 终局判定（玩家死→dead；done+活→won；done+未生→unborn；否则回 awaiting-action）。
  - `start()`: while 玩家未生且未 done：`runTick(null)`。
  - 守卫：phase 不符抛 Error；done 后任何 submit 抛 Error。
- [ ] **Step 4:** Run → PASS。
- [ ] **Step 5: Commit** `feat(solo): match session state machine`

### Task 20: solo/view.ts（感知过滤 + 视图模型）

**Files:** Create `src/lib/solo/view.ts`、`src/lib/solo/gates.ts`（从 action-grid 抽出的纯函数 gateOf）；Test `src/lib/solo/view.test.ts`、`src/lib/solo/gates-parity.test.ts`

**Interfaces:** Produces:
```ts
export interface MarkerView { id: number; x: number; y: number;
    state: "self" | "queued" | "known" | "observed" | "public" | "domain";
    tech?: number; res?: number; ping?: boolean }
export interface LogEntryView { tick: number; key: MessageKey; params?: Record<string, string | number> }
export type EndView = { kind: "dead"; cause: DeathCause; ticks: number; kills: number; loot: number }
                  | { kind: "won"; nAlive: number } | { kind: "unborn" };
export interface MatchView { phase; tick; tMax; nAlive; freePool;
    self: { slot: number; tech: number; res: number; inDomain: boolean; windup: boolean } | null;
    markers: MarkerView[]; valid: boolean[]; lastAction: number; targetCandidates: number[];
    invasion: { invaderId: number } | null; end: EndView | null }
export class ViewTracker { constructor(m: SoloMatch); update(): MatchView; }   // 持 prev 知识集，累计 log
export function viewLogOf(tracker): LogEntryView[];
```
**感知过滤实现规则**（规格 §7 规则表逐条，代码注释锚定）：本刻 `info` 中 `i==playerSlot` 的 strike_events/invasions → own 系日志；`public[j]` 由 0→1 → log.broadcast（j 可见，规则④）；`known[player][j]` 增量且非 public 路径 → log.contact（坐标 (x,y)，规则③）；已知存活集缩差 → log.dark（规则⑥，无死因）；`info.n_alive` 上增且无新 known → log.born（情报-free，规则⑩）；`invaded` 含玩家 → log.invaded（环境显式通知，规则②）；玩家死亡刻 → log.death。其余 info 事件一律不产生日志（规则⑦⑧⑨——**他人 strike/探测/反曝光一律丢弃**）。markers = self（琥珀）+ `known[player][j] & alive[j]` 行：`in_domain[j]`→domain（封存，含冻结情报）、`public[j]`→public、`observed[player][j]`→observed（带 tech/res）、否则 known；queued 幽灵仅出生前（self 未生时一个 ghost）。

- [ ] **Step 1: 失败测试**——用 Task 19 的场景接缝逐规则断言：
  - AI 互打刻（info 有 strikes 但 i,j 均非玩家）：`viewLogOf` 该刻新增**零**条目（Review Focus 2）；nAlive 下降可见。
  - 玩家探测：known 增量 → 恰一条 log.contact 且 params.x/y = 目标坐标；marker state "known"；OBSERVE 后同 slot 变 "observed" 且 log.observed 带 tech/res。
  - 玩家打击被挡：恰 log.ownStrikeBlocked（take）；命中：log.ownStrikeHit；落空：log.ownStrikeMiss。
  - 玩家广播：本刻 log.ownBroadcast；下刻目标 j public 化 → log.broadcast + marker "public"。
  - 已知者死亡（被他人打死）：log.dark，无死因；marker 消失。
  - 排队幽灵：start 前 update() → phase queued + 单个 "queued" 幽灵 marker + log 含 waitBirth；出生刻 → log 出生自报（match.birthSelf）。
  - gates-parity（Review Focus 5）：`for tech × res × hasKnown × domain × windup 全 288 组合`：`gateOf` 判禁的每个动作 ⇒ `env.valid()` 行同为 0（makeEnv 篡改后逐组合比对）。
- [ ] **Step 2/3/4:** 实现 → 全绿。
- [ ] **Step 5: Commit** `feat(solo): perception filter + view models`

### Task 21: /solo 接线（选择 → 开始对局）

**Files:** Modify `src/app/solo/page.tsx`；Test 无独立文件（UI 薄层；行为由 /match 任务覆盖）

- [ ] **Step 1:** 选择态落地：`useState<Set<string>>`（默认空或预选 1 项）；卡片点击切换选中；`开始对局` 禁用当空；点击 → `router.push(\`/match?op=${[...sel].join(",")}\`)`。对手清单数据源换 `catalog.ts`（PRESET_IDS + MODEL_CATALOG），名称/描述沿用现有词典键与 mock 的渲染约定（若发现 mock 中有双语硬写，按 §7 补键替换——执行时核对）。
- [ ] **Step 2:** `bun run check` + dev 手查 /solo 选择与跳转 URL。
- [ ] **Step 3: Commit** `feat(ui): solo selection wiring`

### Task 22: /match 接线 + i18n 新键 + demo bar 移除

**Files:** Modify `src/app/match/page.tsx`、`src/components/action-grid.tsx`（改 import gates.ts）、`src/components/event-log.tsx`（LOG_KEY/LOG_TONE 扩展）、`src/components/end-overlay.tsx`（三终态）、`src/i18n/en.ts`、`src/i18n/zh.ts`、`DESIGN.md §7`；Create `src/lib/solo/client.ts`（fetch 权重 + 构造 match 的装配层）

- [ ] **Step 1: DESIGN.md §7 先行补行（硬流程）**，随后 en.ts + zh.ts 同步（删 `log.blocked`，其义并入 own 键）：
  - `log.dark` "已知信号消失" / "A known contact went dark"
  - `log.ownStrikeHit` "你的打击命中了 #{id}" / "Your strike hit #{id}"
  - `log.ownStrikeMiss` "你的打击未命中 #{id}" / "Your strike missed #{id}"
  - `log.ownStrikeBlocked` "你的打击被护盾挡下（#{id} 耗散 {take}）" / "Your strike was blocked by a shield (#{id} shed {take})"
  - `log.ownInvade` "你入侵了 #{id}，缴获 {loot}" / "You invaded #{id}, looted {loot}"
  - `log.ownBroadcast` "你广播了坐标，下刻向全体公开" / "You broadcast — public to all next tick"
  - `log.born` 文案改（去参数）"一个新文明诞生了" / "A new civilization is born"
  - `match.birthSelf` "你的文明诞生了" / "Your civilization is born"
  - `match.waitBirth` "等待出生——世界运行中" / "Waiting to be born — the world runs on"
  - `match.target.skip` "不选目标，打击最近已知" / "Skip targeting — strike nearest known"
  - `end.unborn.title` "你未及诞生" / "You were never born"
  - `end.unborn.body` "世界在你出生前归于热寂。" / "The world fell silent before your birth."
  - `solo.loading` "正在装载对手模型…" / "Loading opponent models…"
- [ ] **Step 2: 装配层 client.ts**：`useSearchParams` 读 `op` → `ids = op.split(",")`；`isOpponentId` 全验失败 → `router.replace("/solo")`；所需模型并发 `loadModel`（缺失文件 404 → 同样回 /solo）；`seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1`；`console.info("[darkforest] match seed", seed)`；构造 `SoloMatch` + `ViewTracker`。加载期渲染 solo.loading 行。
- [ ] **Step 3: 页面状态机接线**（useReducer；事件驱动，无 effect setState）：
  - TopBar：`view.tick/tMax/nAlive/freePool`；queued 期 = 幽灵排队视图（TopBar 读数 + match.waitBirth 日志行 + 星图 ghost marker）。
  - StarChart：`markers` → 组件现有 civ 形状（id/x/y/state/tech?/res?）；armed 动作 ∈ {STRIKE, INVADE} 时 `selectableIds = view.targetCandidates`（env `selectTargets` 行）；INVARE 必须点选；STRIKE 提供 `match.target.skip` 按钮（target=-1 提交）。
  - ActionGrid：props 加 `valid: boolean[]`；禁用 = `!valid[a]`，原因文案继续用 gates.ts（与 env parity 已由 gates-parity 测试锁定）；armed/lastAction 照旧。
  - EventLog：`viewLogOf(tracker)` → 现有行渲染；LOG_KEY/LOG_TONE 补新键映射；坐标/数字格式按 §7（toFixed(1)，tnum）。
  - InvasionModal：`view.invasion` 非空时显示；`onCounter → submitRechoice(6)`；`onDomain → submitRechoice(5)`（`valid[5]` 为 0 时禁用并给门槛原因）；`onCancel → submitRechoice(本刻原动作)`。
  - EndOverlay：三终态（dead：cause/ticks/kills/loot；won：nAlive；unborn）。
  - **demo bar 删除**（DEMO_KEY/DEMO_STATES/mock 引用一并清理；/online 用的 mock 保留）。
- [ ] **Step 4: 验证**：`bun test && bun run check && bun run build` 全绿；dev 手查：/solo 选 df 开始 → 幽灵 → 诞生 → 静默/发展若干刻 → 日志双语正确 →（用接缝 seed 复现）入侵模态三选 → 终局覆盖层。reduced-motion 下无动画回归。
- [ ] **Step 5: Commit** `feat(ui): real solo match wiring`

---

## M5：收尾

### Task 23: 文档 + 全量验证 + 交付

**Files:** Modify `CLAUDE.md`、`DESIGN.md`（§7 已在 Task 22 改，此处核漏）；Create 无

- [ ] **Step 1: CLAUDE.md 更新**：① 常用命令加 `bun test` 与三个 golden 脚本（含 PYTHONUTF8=1 说明）；② 开发顺序标注：步骤 1（环境移植+验收）与步骤 4（对手接入+单机接线）**已完成**，下一步 = 在线模式（步骤 5）；③ 落地备忘补：engine/opponents/solo 三层与 DI 约定、种子派生公式、`public/models` 长缓存、`src/lib/engine/testdata` 口径文档位置、"UI 只可消费 view.ts 视图模型（感知过滤在 view 层，勿在组件层读 env）"。
- [ ] **Step 2: 全量验证**：
  - `bun test`（含 6 条金标准回放 + strike-fix + quirks + parity + 会话/视图/gates 全套）
  - `bun run check`、`bun run build`
  - 生产冒烟：`bun run build && bun run start` 后 curl `/match?op=df`（200、无 demo bar 字样）、`curl -I /models/main.json`（200 + `Cache-Control: public, max-age=31536000, immutable`）、`/solo`、`/online`、`/` 正常。
  - `git status` 与本计划文件地图逐项核对；`git -C experiment status --porcelain` 必须为空。
- [ ] **Step 3: 人工走查清单（交用户验收）**：vs 主模型一局全程（含被 AI 入侵/观测反曝光/黑域各出现至少一次的种子局）；vs df 一局（打击流）；弱科技出生局；终局三态；zh/en 两语各过一遍日志；键盘 Tab 焦点；reduced-motion 全灭；devtools Network 确认模型按需加载且缓存命中。
- [ ] **Step 4: Commit** `docs: phase complete — engine + opponents + solo wiring`

---

## 计划自查（writing-plans Self-Review 结果）

1. **规格覆盖**（game-mechanics.md § → 任务）：§1 模块架构→T2/3/4/15-20；§2 Rng→T3（seedOf 约定贯穿 T19）；§3 移植要点→T4-10 + README（T14）；§4 验收门→T11/12/13/14（门 1-5 与 dqn-parity/stat 全落地）；§5.1 管线→T15-17；§5.2/5.3 对手→T17/18；§6 会话→T19；§7 感知→T19/20（测试钉规则①-⑪）；§8 UI→T21/22；§9 依赖→T1/15；§10 里程碑=本文结构；§11 决策→各任务。无缺口。
2. **占位符扫描**：无 TBD/TODO；Task 17 测试中 `expectedArgmax` 标注"执行时以实际输出填"（该值依赖 numpy 录制产物，计划阶段不可预知——非占位符，属生成数据）；Task 21 命名渲染以既有 mock 约定为准并要求执行时核对。
3. **类型一致性**：Rng 四方法（uniform/uniformRange/uniformArray/choice）在 T3 定义后 T7-9/17/18/19 使用一致；`DarkForestEnv2` 方法名（reset/selectTargets/beginTick/resolve/obs/valid）跨任务一致；`snapshot/compareState/assertConservation`（T4→T14）；`ModelWeights`（T15 产 → T17/19 消费）；`MatchView/LogEntryView/EndView`（T20 产 → T22 消费）；`gateOf` 抽至 gates.ts（T20 定义 → T22 引用）。ScriptedRng.consumed 语义=按值计数（T3 定，T8 断言 1296 与之一致）。
4. **Review Focus 钉测**：RF1→T14 ReplayRng 断言；RF2→T20 感知用例；RF3→T17 parity（1e-9 宽限已论证）；RF4→T9 done 抛错 + T19 ended 守卫；RF5→T20 gates-parity 288 组合。

**已知执行风险**（非计划缺陷，按预案处理）：①金标准回放首跑必然 FAIL——以 diff 输出逐项修**引擎**直至绿（T14 Step 3 明示）；②numpy BLAS 与 TS 求和序差异——容差策略已论证；③React Compiler 对页面状态机的 lint 约束（勿 effect setState）——装配层用事件驱动 reducer。
