/**
 * DarkForestEnv2 —— v2.4 的忠实 TS 移植。
 *
 * 权威源：experiment/experiment/env2_v24.py（654 行）。字段名/方法集与其一一对应
 * （_obs→obs()、_valid→valid()、_pair_dist→pairDist）；quirk 清单见
 * docs/env-model-v23.md §0（Q1-Q13），全部照抄。
 *
 * v2.4 vs v2.3-fix：BROADCAST_SELF→BROADCAST_ALL（改名）；BROADCAST_OTHER 恢复为
 * 「揭露 known 目标」；删 STRIKE_WEAK/STRONG；OBSERVE 显式选目标；出生无科技继承
 * （恒 tech_spawn_lo，每出生少 1 个 RNG 值）；奖励臂参数 res_reward_scale/attack_reward。
 *
 * 与 python 的既定差异（见 docs/game-mechanics.md §2/§3）：
 * - 随机数经构造期注入（Rng 接口 = uniform/choice 两法）；reset() 无 seed 参数。
 * - numpy 向量化 → 显式循环（36 槽规模无关紧要）。
 * - obs/valid 平铺行主序：obs[i*36+k]、valid[i*8+a]。
 * - TickResult.rewardDetail：TS-only 奖励诊断（游戏层扩展，非 parity——录制端无此字段）。
 */
import type { EnvConfig } from "./config";
import { numpyArgsort } from "./numpy-sort";
import type { Rng } from "./rng";
import {
    A_BALL,
    A_BDOMAIN,
    A_BOTHER,
    A_DEVELOP,
    A_INVADE,
    A_OBSERVE,
    A_SILENT,
    A_STRIKE,
    N_ACTIONS,
    NEAR_K,
    OBS_DIM,
    type DeathCause,
    type StrikeEvent,
    type TickInfo,
    type TickResult,
} from "./types";

/** resolve() 各阶段共享的刻内累积器（python 中为函数局部量） */
interface TickCtx {
    eff: Int32Array; // sanitize 后的实际动作
    rawActions: Int32Array; // re 覆盖后的原始动作（阶段 5 反咬判定用它，非 eff）
    rewards: Float64Array;
    detections: [number, number][];
    strikes: [number, number, boolean][];
    invasions: [number, number, boolean][];
    lootTo: Float64Array;
    diedThisTick: [number, DeathCause][];
    strikesBlocked: [number, number, number][];
    strikeEvents: StrikeEvent[];
    counterDetections: number;
    deadNow: Uint8Array;
    kills: Map<number, number>; // 阶段 4：victim → killer
    knownAliveD: Float64Array; // 阶段 4 构建、阶段 6 复用（含打击前的活标志快照——照抄 env2_v24.py）
    /** TS-only 奖励诊断累积（rewardDetail 的原料；techTerm/resAtReward 在 stageRewards 填） */
    attackCount: Int32Array;
    bdEnter: Uint8Array;
    techTerm: Float64Array;
    resAtReward: Float64Array;
}

export class DarkForestEnv2 {
    // ---- config（env2.py:115-151 的 self.* 参数镜像）----
    readonly n: number;
    readonly cfg: EnvConfig;
    private readonly world: number;
    private readonly detect_radius: number;
    private readonly t_max: number;
    private readonly p_detect_base: number;
    private readonly stealth_mult: number;
    private readonly p_detect_max: number;
    private readonly p_explosion: number;
    private readonly develop_rate: number;
    private readonly tech_cap: number;
    private readonly tech_spawn_lo: number;
    private readonly tech_spawn_hi: number;
    private readonly kill_base: number;
    private readonly kill_tech_slope: number;
    private readonly res_min: number;
    private readonly res_max: number;
    private readonly p_deplete: number;
    private readonly deplete_lo: number;
    private readonly deplete_hi: number;
    private readonly gate_broadcast_tech: number;
    private readonly gate_broadcast_res: number;
    private readonly gate_observe_tech: number;
    private readonly gate_domain_tech: number;
    private readonly gate_strike_tech: number;
    private readonly death_penalty: number;
    private readonly bd_entry_penalty: number;
    private readonly bd_growth_mult: number;
    private readonly bd_explosion_mult: number;
    private readonly enable_black_domain: boolean;
    private readonly spawn_schedule: [number, number][];
    readonly res_total: number;
    private readonly shield_cost_frac: number;
    private readonly softsign_a: number;
    private readonly softsign_reward_scale: number;
    private readonly res_reward_scale: number; // v2.4 奖励臂
    private readonly attack_reward: number; // v2.4 奖励臂

    readonly rng: Rng;

    // ---- state（env2.py reset() 建立的全部字段）----
    pos: Float64Array; // n*2，行主序
    tech: Float64Array;
    res: Float64Array;
    alive: Uint8Array;
    known: Uint8Array; // n*n
    observed: Uint8Array; // n*n
    public_: Uint8Array; // `public` 是 TS 保留字
    in_domain: Uint8Array;
    domain_windup: Uint8Array;
    pending_reveal: ["self" | "other", number][]; // env2_v24.py 的 (kind, j)——v2.4 增 "other" 揭露
    pending_counter: number[];
    last_action: Int32Array;
    first_detect_tick: Int32Array; // n*n，初始 -1
    free_pool: number;
    pending_spawns: number[];
    birth_log: [number, number, number][]; // [tick, slot, spawn_res]
    death_cause: DeathCause[];
    spawn_tick: Float64Array; // 未生 = 1e9
    spawn_tech: Float64Array;
    spawn_res: Float64Array;
    peak_tech: Float64Array;
    t = 0;

    // ---- transient tick state（env2.py:153-156）----
    _invaders = new Map<number, number>(); // victim -> invader
    _targets = new Map<number, number>(); // actor -> target
    _actions: Int32Array | null = null;
    _done = false;
    /** python hasattr(self,"pos") 的哨兵（Q1 拒绝环用） */
    private _hasPos = false;

    constructor(cfg: EnvConfig, rng: Rng) {
        this.cfg = cfg;
        this.n = cfg.nAgents;
        this.world = cfg.world;
        this.detect_radius = cfg.detectRadius;
        this.t_max = cfg.tMax;
        this.p_detect_base = cfg.pDetectBase;
        this.stealth_mult = cfg.stealthMult;
        this.p_detect_max = cfg.pDetectMax;
        this.p_explosion = cfg.pExplosion;
        this.develop_rate = cfg.developRate;
        this.tech_cap = cfg.techCap;
        this.tech_spawn_lo = cfg.techSpawnLo;
        this.tech_spawn_hi = cfg.techSpawnHi;
        this.kill_base = cfg.killBase;
        this.kill_tech_slope = cfg.killTechSlope;
        this.res_min = cfg.resMin;
        this.res_max = cfg.resMax;
        this.p_deplete = cfg.pDeplete;
        this.deplete_lo = cfg.depleteLo;
        this.deplete_hi = cfg.depleteHi;
        this.gate_broadcast_tech = cfg.gateBroadcastTech;
        this.gate_broadcast_res = cfg.gateBroadcastRes;
        this.gate_observe_tech = cfg.gateObserveTech;
        this.gate_domain_tech = cfg.gateDomainTech;
        this.gate_strike_tech = cfg.gateStrikeTech;
        this.death_penalty = cfg.deathPenalty;
        this.bd_entry_penalty = cfg.bdEntryPenalty;
        this.bd_growth_mult = cfg.bdGrowthMult;
        this.bd_explosion_mult = cfg.bdExplosionMult;
        this.enable_black_domain = cfg.enableBlackDomain;
        this.spawn_schedule = cfg.spawnSchedule;
        this.res_total = cfg.resTotalBudget;
        this.shield_cost_frac = cfg.shieldCostFrac;
        this.softsign_a = cfg.softsignA;
        this.softsign_reward_scale = cfg.softsignRewardScale;
        this.res_reward_scale = cfg.resRewardScale;
        this.attack_reward = cfg.attackReward;
        this.rng = rng;

        const n = this.n;
        // 先占位（构造后立刻 reset()；声明为非空以简化类型）
        this.pos = new Float64Array(n * 2);
        this.tech = new Float64Array(n);
        this.res = new Float64Array(n);
        this.alive = new Uint8Array(n);
        this.known = new Uint8Array(n * n);
        this.observed = new Uint8Array(n * n);
        this.public_ = new Uint8Array(n);
        this.in_domain = new Uint8Array(n);
        this.domain_windup = new Uint8Array(n);
        this.pending_reveal = [];
        this.pending_counter = [];
        this.last_action = new Int32Array(n);
        this.first_detect_tick = new Int32Array(n * n).fill(-1);
        this.free_pool = this.res_total;
        this.pending_spawns = [];
        this.birth_log = [];
        this.death_cause = new Array<DeathCause>(n).fill("");
        this.spawn_tick = new Float64Array(n);
        this.spawn_tech = new Float64Array(n);
        this.spawn_res = new Float64Array(n);
        this.peak_tech = new Float64Array(n);
    }

    // ------------------------------------------------------------------ utils
    /** 环面成对距离矩阵（env2.py:159-162）；缺省用 this.pos，可显式传旧位置（Q1） */
    pairDist(pos: Float64Array = this.pos): Float64Array {
        const n = this.n;
        const d = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                let dx = Math.abs(pos[i * 2] - pos[j * 2]);
                let dy = Math.abs(pos[i * 2 + 1] - pos[j * 2 + 1]);
                dx = Math.min(dx, this.world - dx);
                dy = Math.min(dy, this.world - dy);
                d[i * n + j] = Math.hypot(dx, dy);
            }
        }
        return d;
    }

    // ------------------------------------------------------------------ reset
    /** env2.py:164-216。TS 无 seed 参数：播种在构造期 DI 完成。 */
    reset(): { obs: Float32Array; valid: Uint8Array } {
        const n = this.n;
        const rng = this.rng;
        const pos = rng.uniformArray(n * 2, 0, this.world);
        // Q1（env2.py:170-177）：拒绝环读取【旧】 self.pos（hasattr 语义 → _hasPos 哨兵）
        // ——旧位置全同点时 bad 集合不变，每轮仅重掷首个 bad 对两值、最多 400 轮。
        for (let k = 0; k < 400; k++) {
            if (!this._hasPos) break; // 首次（无旧位置）：全 inf → 立即接受
            const d = this.pairDist(this.pos);
            let first = -1;
            search: for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    if (d[i * n + j] < 12.0) {
                        first = i;
                        break search;
                    }
                }
            }
            if (first < 0) break;
            const fresh = rng.uniformArray(2, 0, this.world);
            pos[first * 2] = fresh[0];
            pos[first * 2 + 1] = fresh[1];
        }
        this.pos = pos;
        this._hasPos = true;

        // v2.2 资源守恒：固定总预算；离场物质归自由池；出生由池内生
        this.free_pool = this.res_total;
        this.spawn_tick = new Float64Array(n).fill(10 ** 9); // 未生（池门控队列）
        const n0 = this.spawn_schedule.length > 0 ? this.spawn_schedule[0][1] : n;
        for (let i = 0; i < n0; i++) this.spawn_tick[i] = 0;
        this.tech = new Float64Array(n);
        this.res = new Float64Array(n);
        const tech0 = rng.uniformArray(n0, this.tech_spawn_lo, this.tech_spawn_hi);
        const res0 = rng.uniformArray(n0, this.res_min, this.res_max);
        let sum0 = 0;
        for (let i = 0; i < n0; i++) sum0 += res0[i];
        const scale = sum0 > this.res_total ? this.res_total / sum0 : 1; // 初始群恰好入预算
        for (let i = 0; i < n0; i++) this.tech[i] = tech0[i];
        for (let i = 0; i < n0; i++) this.res[i] = res0[i] * scale;
        let resSum = 0;
        for (let i = 0; i < n; i++) resSum += this.res[i];
        this.free_pool = this.res_total - resSum;

        // v2.3：恒恰一个预滚的下次出生资源；每次出生再滚下一个
        this.pending_spawns = [rng.uniformRange(this.res_min, this.res_max)];
        this.spawn_tech = Float64Array.from(this.tech);
        this.spawn_res = Float64Array.from(this.res);
        this.birth_log = [];
        this.death_cause = new Array<DeathCause>(n).fill(""); // "" 存活/未生
        this.peak_tech = Float64Array.from(this.tech);
        this.alive = new Uint8Array(n);
        for (let i = 0; i < n0; i++) this.alive[i] = 1; // 后续群：内生出生
        this.known = new Uint8Array(n * n);
        this.observed = new Uint8Array(n * n);
        this.public_ = new Uint8Array(n);
        this.in_domain = new Uint8Array(n);
        this.domain_windup = new Uint8Array(n);
        this.pending_reveal = [];
        this.pending_counter = [];
        this.last_action = new Int32Array(n).fill(A_SILENT);
        this.first_detect_tick = new Int32Array(n * n).fill(-1);
        this.t = 0;
        this._invaders = new Map();
        this._targets = new Map();
        this._actions = null;
        this._done = false;
        return { obs: this.obs(), valid: this.valid() };
    }

    // ------------------------------------------------------------------- obs
    /**
     * 36 维观测（env2_v24.py:305-347）：7 标量 + 8 上刻动作 one-hot + 3 个最近已知
     * 存活非域文明 × 7。死亡/未生行整行清零。crowd（env2_v24.py:308）为死代码，不移植。
     * 近邻排序用稳定排序——被掩蔽行输出恒为零向量，平手序差异无害（规格 §3.3）。
     */
    obs(): Float32Array {
        const n = this.n;
        const LOG_REF = Math.log1p(50.0);
        const dist = this.pairDist();
        const out = new Float32Array(n * OBS_DIM);
        let aliveCount = 0;
        for (let j = 0; j < n; j++) if (this.alive[j]) aliveCount++;
        for (let i = 0; i < n; i++) {
            if (!this.alive[i]) continue; // 死亡/未生行整行清零
            const base = i * OBS_DIM;
            out[base + 0] = Math.fround(Math.log1p(Math.max(this.tech[i], 0)) / LOG_REF);
            out[base + 1] = Math.fround(Math.max(this.res[i], 0) / this.res_max);
            let knownAlive = 0;
            for (let j = 0; j < n; j++) {
                if (this.known[i * n + j] && this.alive[j]) knownAlive++; // 含 known[i,i]（Q2）
            }
            out[base + 2] = Math.fround(knownAlive / (n - 1));
            out[base + 3] = Math.fround(aliveCount / n);
            out[base + 4] = Math.fround(this.t / this.t_max);
            out[base + 5] = this.in_domain[i];
            out[base + 6] = this.domain_windup[i];
            out[base + 7 + this.last_action[i]] = 1; // one-hot
            // big 行（env2_v24.py:324-326）：known & alive & 距离 ≤ 半径 → 真实距离，
            // 否则 inf（对角恒 inf；【不滤域内者】——域内目标以真实几何进入）。
            const big = new Float64Array(n).fill(Infinity);
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (
                    dist[i * n + j] <= this.detect_radius &&
                    this.known[i * n + j] &&
                    this.alive[j]
                )
                    big[j] = dist[i * n + j];
            }
            // order = np.argsort(big)（env2_v24.py:327）——**须逐位复刻 numpy**（含 inf
            // 平局序）：候选不足 3 时掩码行的 tech/res/public 取排序后第 k 位文明的
            // known_pair/observed 旗标（距离无关）——伪影但为权威行为（numpy-sort.ts）。
            const order = numpyArgsort(big);
            // 近邻块为 feature-major（np.concatenate(axis=-1) 拼各 (n,NEAR_K) 列组）：
            // [15+k]=Δx [18+k]=Δy [21+k]=d [24+k]=tech [27+k]=res [30+k]=public [33+k]=in_domain
            for (let k = 0; k < NEAR_K; k++) {
                const j = order[k];
                const dmask = Number.isFinite(big[j]); // 几何特征门（掩码行 Δx/Δy/d = 0）
                const knownPair =
                    this.known[i * n + j] === 1 &&
                    this.alive[j] === 1 &&
                    this.in_domain[j] === 0; // 情报特征门（距离无关——照抄）
                let dx = 0;
                let dy = 0;
                let d = 0;
                if (dmask) {
                    // 域内目标亦以真实几何进入（big 不滤域内者）
                    dx = this.pos[j * 2] - this.pos[i * 2];
                    dy = this.pos[j * 2 + 1] - this.pos[i * 2 + 1];
                    dx -= this.world * Math.round(dx / this.world); // 环面回绕
                    dy -= this.world * Math.round(dy / this.world);
                    d = big[j];
                }
                const hasIntel = knownPair && this.observed[i * n + j] === 1;
                const nearTech = hasIntel ? this.tech[j] : -1;
                const nearRes = hasIntel ? this.res[j] : -1;
                out[base + 15 + k] = Math.fround(dx / 50);
                out[base + 18 + k] = Math.fround(dy / 50);
                out[base + 21 + k] = Math.fround(d / 50);
                out[base + 24 + k] =
                    nearTech >= 0 ? Math.fround(Math.log1p(Math.max(nearTech, 0)) / LOG_REF) : -1;
                out[base + 27 + k] = Math.fround(nearRes / this.res_max);
                out[base + 30 + k] = knownPair && this.public_[j] === 1 ? 1 : 0;
                out[base + 33 + k] = 0; // Q3：in_domain 特征恒 0（×known_pair 含 ~in_domain）
            }
        }
        return out;
    }

    // ----------------------------------------------------------------- masks
    /**
     * 合法动作掩码（env2_v24.py:278-298）。平铺 n×8，行主序 valid[i*8+a]。
     * strikeable 行 = 存在（已知 & 活 & 非域 & 非风窗）目标且自身活；
     * v2.4：BOTHER（揭露）需 strikeable 目标 + 广播门（tech>1 或 res>10）。
     */
    valid(): Uint8Array {
        const n = this.n;
        const v = new Uint8Array(n * N_ACTIONS).fill(1);
        // strikeable = (known & alive[j] & ~in_domain[j] & ~windup[j]).any(j) & alive[i]
        const strikeable = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            if (!this.alive[i]) continue;
            for (let j = 0; j < n; j++) {
                if (this.known[i * n + j] && this.alive[j] && !this.in_domain[j] && !this.domain_windup[j]) {
                    strikeable[i] = 1;
                    break;
                }
            }
        }
        for (let i = 0; i < n; i++) {
            const r = i * N_ACTIONS;
            const gateB = this.tech[i] > this.gate_broadcast_tech || this.res[i] > this.gate_broadcast_res;
            v[r + A_BOTHER] = strikeable[i]; // v2.4：揭露恢复（需 known 存活非域目标）
            v[r + A_STRIKE] = strikeable[i];
            v[r + A_INVADE] = strikeable[i];
            v[r + A_OBSERVE] = strikeable[i];
            if (!gateB) v[r + A_BALL] = 0;
            if (!gateB) v[r + A_BOTHER] = 0;
            if (this.tech[i] <= this.gate_observe_tech) v[r + A_OBSERVE] = 0;
            v[r + A_BDOMAIN] = this.enable_black_domain && this.tech[i] > this.gate_domain_tech && this.alive[i] ? 1 : 0;
            if (this.tech[i] <= this.gate_strike_tech) {
                v[r + A_STRIKE] = 0;
            }
            if (this.in_domain[i] || this.domain_windup[i]) {
                // 域内/风窗：仅 DEVELOP/SILENT（BD 重声明无害：entering 判定排除在域者）
                for (const a of [A_BOTHER, A_STRIKE, A_INVADE, A_OBSERVE, A_BALL]) v[r + a] = 0;
            }
            if (!this.alive[i]) {
                // 未生/已死：本刻不行动；SILENT 恒合法（驱动器可安全传全 0）
                for (let a = 0; a < N_ACTIONS; a++) v[r + a] = 0;
                v[r + A_SILENT] = 1;
            }
        }
        return v;
    }

    /**
     * 需要显式目标的动作（v2.4：INVADE/STRIKE/BOTHER/OBSERVE）的候选掩码
     * （env2_v24.py:350-356）。注意：候选仅排除【域内】目标，不排除风窗
     * （与 valid 的 strikeable 不同——照抄）。
     */
    selectTargets(actions: Int32Array): Uint8Array {
        const n = this.n;
        const out = new Uint8Array(n * n);
        for (let i = 0; i < n; i++) {
            if (
                actions[i] !== A_INVADE &&
                actions[i] !== A_STRIKE &&
                actions[i] !== A_BOTHER &&
                actions[i] !== A_OBSERVE
            )
                continue;
            for (let j = 0; j < n; j++) {
                out[i * n + j] = this.known[i * n + j] && this.alive[j] && !this.in_domain[j] ? 1 : 0;
            }
        }
        return out;
    }

    // ------------------------------------------------------- two-phase protocol
    /**
     * 锁定动作+目标；施加入侵通知；返回受入侵者列表（升序）——
     * 受害者现在就知道入侵者，可在 resolve 前重选（env2.py:342-360）。
     */
    beginTick(actions: Int32Array, targets: Int32Array | null): number[] {
        const n = this.n;
        this._actions = Int32Array.from(actions);
        this._targets = new Map();
        if (targets !== null) {
            const mask = this.selectTargets(this._actions); // 纯读，循环外一次即可
            for (let i = 0; i < n; i++) {
                if (
                    this._actions[i] !== A_INVADE &&
                    this._actions[i] !== A_STRIKE &&
                    this._actions[i] !== A_BOTHER &&
                    this._actions[i] !== A_OBSERVE
                )
                    continue;
                const j = targets[i];
                if (j >= 0 && mask[i * n + j] === 1) this._targets.set(i, j);
            }
        }
        // 入侵通知：受害者【当场】发现入侵者（env2.py:353-359）
        this._invaders = new Map();
        for (const [i, j] of this._targets) {
            if (this._actions[i] === A_INVADE && this.alive[i] === 1 && this.alive[j] === 1) {
                this.known[j * n + i] = 1;
                this.first_detect_tick[j * n + i] = this.t;
                this._invaders.set(j, i);
            }
        }
        return [...this._invaders.keys()].sort((a, b) => a - b);
    }

    // ---------------------------------------------------------------- resolve
    /**
     * 全刻结算（env2.py:362-628）。reActions 覆盖受入侵者的动作。
     * 阶段序：sanitize → 0 域激活 → 0.5 反曝光 → 1 延迟广播 → 2 被动探测
     * → 3 广播入队 → 4 打击 → 5 入侵 → 6 观测 → 7 发展/爆炸 → 8 流失/饿死
     * → 8b 尸体结算 → 9 奖励 → 10 出生 → 尾部。
     */
    resolve(reActions: Int32Array): TickResult {
        if (this._done) throw new Error("episode done");
        if (this._actions === null)
            throw new Error("beginTick(actions, targets) must precede resolve()");
        const n = this.n;
        const actions = Int32Array.from(this._actions);
        const re = Int32Array.from(reActions);
        for (const v of this._invaders.keys()) actions[v] = re[v];

        const ctx: TickCtx = {
            eff: new Int32Array(n),
            rawActions: actions,
            rewards: new Float64Array(n),
            detections: [],
            strikes: [],
            invasions: [],
            lootTo: new Float64Array(n),
            diedThisTick: [],
            strikesBlocked: [],
            strikeEvents: [],
            counterDetections: 0,
            deadNow: new Uint8Array(n),
            kills: new Map(),
            knownAliveD: new Float64Array(0),
            attackCount: new Int32Array(n),
            bdEnter: new Uint8Array(n),
            techTerm: new Float64Array(n),
            resAtReward: new Float64Array(n),
        };

        this.stageSanitize(ctx, actions); // env2.py:373-393
        this.stageDomain(ctx); // 0   env2.py:395-400
        this.stageCounter(ctx); // 0.5 env2.py:402-418
        this.stageDelayedBroadcasts(ctx); // 1   env2.py:420-425
        this.stagePassiveDetection(ctx); // 2   env2.py:427-442
        this.stageQueueBroadcasts(ctx); // 3   env2.py:444-450
        this.stageStrikes(ctx); // 4   Task 8
        this.stageInvasions(ctx); // 5   Task 8
        this.stageObserve(ctx); // 6   Task 9
        this.stageEconomy(ctx); // 7+8 Task 9
        this.stageSettlement(ctx); // 8b  Task 9
        this.stageRewards(ctx); // 9   Task 9
        this.stageBirths(ctx); // 10  Task 9

        this.last_action = Int32Array.from(ctx.eff); // env2.py:608
        // died_this_tick 装配（env2.py:619）：deadNow 升序 × 当刻死因
        ctx.diedThisTick = [];
        for (let v = 0; v < n; v++) {
            if (ctx.deadNow[v] === 1) ctx.diedThisTick.push([v, this.death_cause[v]]);
        }
        this.t += 1; // env2.py:609
        // v2.3 结算：定长世界钟——t_max 终局；提前终止仅物理热寂
        // （全员死且池 < 下一次预滚额，env2.py:614-615）
        const heatDeath =
            this.alive.every((a) => a === 0) && this.free_pool < this.pending_spawns[0];
        this._done = this.t >= this.t_max || heatDeath;

        const info: TickInfo = {
            detections: ctx.detections,
            strikes: ctx.strikes,
            invasions: ctx.invasions,
            loot_to: ctx.lootTo,
            died_this_tick: ctx.diedThisTick,
            strikes_blocked: ctx.strikesBlocked,
            strike_events: ctx.strikeEvents,
            free_pool: this.free_pool,
            res_conservation_residual: this.res_total - this.resSum() - this.free_pool,
            n_births: this.birth_log.length,
            n_alive: this.countAlive(),
            in_domain: this.countInDomain(),
            counter_detections: ctx.counterDetections,
        };
        return {
            obs: this.obs(),
            valid: this.valid(),
            rewards: ctx.rewards,
            alive: Uint8Array.from(this.alive),
            done: this._done,
            info,
            deadNow: ctx.deadNow,
            // TS-only 奖励诊断（非 parity）：techTerm/resAtReward 由 stageRewards 填
            rewardDetail: {
                techTerm: ctx.techTerm,
                resAtReward: ctx.resAtReward,
                attackCount: ctx.attackCount,
                bdEnter: ctx.bdEnter,
            },
        };
    }

    private resSum(): number {
        let s = 0;
        for (let i = 0; i < this.n; i++) s += this.res[i];
        return s;
    }

    private countAlive(): number {
        let c = 0;
        for (let i = 0; i < this.n; i++) if (this.alive[i]) c++;
        return c;
    }

    private countInDomain(): number {
        let c = 0;
        for (let i = 0; i < this.n; i++) if (this.in_domain[i]) c++;
        return c;
    }

    // ------------------------------------------------------- resolve stages
    /** sanitize（env2_v24.py:389-406）：无 known 的攻击行、域内高级动作、越门动作 → SILENT */
    private stageSanitize(ctx: TickCtx, actions: Int32Array): void {
        const n = this.n;
        const eff = Int32Array.from(actions);
        const anyKnown = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (this.known[i * n + j] && this.alive[j]) {
                    anyKnown[i] = 1;
                    break;
                }
            }
        }
        for (let i = 0; i < n; i++) {
            if (
                !anyKnown[i] &&
                (eff[i] === A_STRIKE || eff[i] === A_INVADE || eff[i] === A_BOTHER || eff[i] === A_OBSERVE)
            )
                eff[i] = A_SILENT;
        }
        // 域内/风窗仅可 DEVELOP / BDOMAIN(无效重声明) / SILENT
        for (let i = 0; i < n; i++) {
            if (this.in_domain[i] || this.domain_windup[i]) {
                if (eff[i] !== A_DEVELOP && eff[i] !== A_BDOMAIN && eff[i] !== A_SILENT)
                    eff[i] = A_SILENT;
            }
        }
        // tech 门（防御性；mask 正常时不会触达）
        for (let i = 0; i < n; i++) {
            if (eff[i] === A_STRIKE && !(this.tech[i] > this.gate_strike_tech)) eff[i] = A_SILENT;
            if (eff[i] === A_OBSERVE && !(this.tech[i] > this.gate_observe_tech))
                eff[i] = A_SILENT;
            if (eff[i] === A_BDOMAIN && !(this.tech[i] > this.gate_domain_tech))
                eff[i] = A_SILENT;
            const gateB = !(this.tech[i] > this.gate_broadcast_tech || this.res[i] > this.gate_broadcast_res);
            if (eff[i] === A_BALL && gateB) eff[i] = A_SILENT;
            if (eff[i] === A_BOTHER && gateB) eff[i] = A_SILENT;
        }
        if (!this.enable_black_domain)
            for (let i = 0; i < n; i++)
                if (actions[i] === A_BDOMAIN) eff[i] = A_SILENT; // python 用原 actions 判定
        ctx.eff = eff;
    }

    /** 阶段 0：域激活（env2.py:395-400）——上刻声明者转正；本刻声明入风窗并 −0.5 */
    private stageDomain(ctx: TickCtx): void {
        const n = this.n;
        for (let i = 0; i < n; i++) {
            if (this.domain_windup[i]) this.in_domain[i] = 1;
            this.domain_windup[i] = 0;
        }
        for (let i = 0; i < n; i++) {
            const entering =
                ctx.eff[i] === A_BDOMAIN &&
                this.alive[i] === 1 &&
                !this.in_domain[i] &&
                !this.domain_windup[i];
            if (entering) {
                ctx.rewards[i] -= this.bd_entry_penalty;
                ctx.bdEnter[i] = 1; // TS-only 诊断
                this.domain_windup[i] = 1;
            }
        }
    }

    /** 阶段 0.5：观测者反曝光（env2.py:402-418）——to see is to be seen */
    private stageCounter(ctx: TickCtx): void {
        const n = this.n;
        for (const i of this.pending_counter) {
            if (!this.alive[i] || this.in_domain[i]) continue;
            const cand: number[] = [];
            for (let j = 0; j < n; j++) {
                if (this.alive[j] && !this.in_domain[j] && j !== i) cand.push(j);
            }
            if (cand.length === 0) continue;
            const k = this.rng.choice(cand);
            if (!this.known[k * n + i]) {
                this.known[k * n + i] = 1;
                this.first_detect_tick[k * n + i] = this.t;
                ctx.detections.push([k, i]);
                ctx.counterDetections++;
            }
        }
        this.pending_counter = [];
    }

    /** 阶段 1：延迟广播结算（env2.py:420-425）——信号已发出，不在乎发送者存亡 */
    private stageDelayedBroadcasts(_ctx: TickCtx): void {
        const n = this.n;
        for (const [, j] of this.pending_reveal) {
            for (let i = 0; i < n; i++) if (this.alive[i]) this.known[i * n + j] = 1;
            this.public_[j] = 1;
        }
        this.pending_reveal = [];
    }

    /** 阶段 2：被动探测（env2.py:427-442）——p=0.03·√tech·(静默×0.25)，min 0.35 */
    private stagePassiveDetection(ctx: TickCtx): void {
        const n = this.n;
        const dist = this.pairDist();
        const u = this.rng.uniformArray(n * n); // 一次 C 序批量，恒发生
        for (let i = 0; i < n; i++) {
            if (!this.alive[i]) continue;
            for (let j = 0; j < n; j++) {
                if (i === j || !this.alive[j] || this.known[i * n + j]) continue;
                if (dist[i * n + j] > this.detect_radius) continue;
                let p = this.p_detect_base * Math.sqrt(this.tech[i]); // 探测者科技驱动
                if (ctx.eff[j] === A_SILENT) p *= this.stealth_mult; // 目标静默缩截面
                if (this.in_domain[i] || this.domain_windup[i]) p = 0; // 域/风窗探测者行全零
                if (this.in_domain[j]) p = 0; // 域目标不可探测（风窗目标【可】被探测）
                p = Math.min(p, this.p_detect_max);
                if (u[i * n + j] < p) {
                    this.known[i * n + j] = 1;
                    this.first_detect_tick[i * n + j] = this.t;
                    ctx.detections.push([i, j]);
                }
            }
        }
    }

    /**
     * 阶段 3：本刻广播入队（env2_v24.py:457-472）——下刻全体可见。
     * v2.4 双通道：BALL 公布自己坐标；BOTHER（揭露）公布 known 目标坐标——
     * 目标须活且非域（风窗可揭露）；发送者不暴露。揭露付 attack_reward（d 臂）。
     */
    private stageQueueBroadcasts(ctx: TickCtx): void {
        // python 两个独立循环：全部 BALL 先入队（升序），再 BOTHER（升序）——顺序照抄
        for (let i = 0; i < this.n; i++) {
            if (ctx.eff[i] === A_BALL && this.alive[i]) this.pending_reveal.push(["self", i]);
        }
        for (let i = 0; i < this.n; i++) {
            if (ctx.eff[i] === A_BOTHER && this.alive[i]) {
                const j = this._targets.get(i) ?? -1;
                if (j >= 0 && this.known[i * this.n + j] && this.alive[j] === 1 && !this.in_domain[j]) {
                    this.pending_reveal.push(["other", j]);
                    ctx.rewards[i] += this.attack_reward;
                    ctx.attackCount[i]++; // TS-only 诊断
                }
            }
        }
    }

    // ---- Task 8/9 实装；economy/rewards/births 当前为空桩 ----

    /** 行内 argmin（平手取先；全 inf 行返回 0，由 isfinite 守卫拦下） */
    private argminRow(arr: Float64Array, i: number, n: number): number {
        let best = 0;
        let bestV = arr[i * n];
        for (let j = 1; j < n; j++) {
            const v = arr[i * n + j];
            if (v < bestV) {
                bestV = v;
                best = j;
            }
        }
        return best;
    }

    /**
     * 阶段 4：打击（env2_v24.py:474-508）——v2.4 单模式：显式目标（锁定）否则最近已知。
     * （STRIKE_WEAK/STRONG 已删——按未观测的真实科技排序=观测前作弊。）
     * 护盾先于掷骰；击杀认领付 attack_reward（d 臂）。
     */
    private stageStrikes(ctx: TickCtx): void {
        const n = this.n;
        const dist = this.pairDist();
        const knownAliveD = new Float64Array(n * n).fill(Infinity);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (this.known[i * n + j] && this.alive[j] && !this.in_domain[j] && !this.domain_windup[j]) {
                    knownAliveD[i * n + j] = dist[i * n + j];
                }
            }
        }
        ctx.knownAliveD = knownAliveD; // 阶段 6 观测复用（活标志为打击前快照——照抄）
        for (let i = 0; i < n; i++) {
            if (ctx.eff[i] !== A_STRIKE) continue;
            if (!this.alive[i]) continue;
            let j = this._targets.get(i) ?? -1;
            if (
                j < 0 ||
                !(this.known[i * n + j] && this.alive[j] === 1) ||
                this.in_domain[j] === 1 ||
                this.domain_windup[j] === 1
            )
                j = this.argminRow(knownAliveD, i, n); // 最近已知兜底
            if (!Number.isFinite(knownAliveD[i * n + j])) continue; // 无合法目标 → 无事件
            const techI = this.tech[i];
            const techJ = this.tech[j];
            if (techJ >= 2.0 * techI) {
                // 护盾：目标科技 ≥ 2× 打击者——挡下，目标自耗半数入池，不掷骰（Q12）
                const shieldTake = this.shield_cost_frac * Math.max(this.res[j], 0);
                this.res[j] -= shieldTake;
                this.free_pool += shieldTake;
                ctx.strikesBlocked.push([i, j, shieldTake]);
                ctx.strikeEvents.push([i, j, "blocked", techI, techJ, shieldTake]);
                continue;
            }
            const pKill = Math.min(
                0.95,
                Math.max(0.15, this.kill_base + this.kill_tech_slope * (techI - techJ)),
            );
            const killed = this.rng.uniform() < pKill;
            ctx.strikes.push([i, j, killed]);
            ctx.strikeEvents.push([i, j, killed ? "killed" : "survived", techI, techJ, 0]);
            if (killed && this.alive[j] === 1 && !ctx.kills.has(j)) {
                ctx.kills.set(j, i);
                ctx.rewards[i] += this.attack_reward; // v2.4：打击击杀赏金
                ctx.attackCount[i]++; // TS-only 诊断
            }
        }
        // 2026-09-22 修复本体（env2.py:498-506）：击杀置死
        for (const v of ctx.kills.keys()) {
            if (this.alive[v] === 1) {
                this.alive[v] = 0;
                this.death_cause[v] = "strike";
            }
        }
    }

    /** 阶段 5：入侵（env2.py:508-547）——必杀、反咬互毁、掠夺半数；BD 重选当场取消 */
    private stageInvasions(ctx: TickCtx): void {
        const invasionKill = new Map<number, number>();
        for (const [victim, invader] of this._invaders) {
            if (!(this.alive[victim] === 1 && this.alive[invader] === 1)) continue;
            if (this.in_domain[victim] === 1 || this.domain_windup[victim] === 1) continue;
            // 反咬判定用 re 覆盖后的【原始】动作（env2.py:515）——不进 sanitize/门（Q9）
            const reV = ctx.rawActions[victim];
            const counter = reV === A_INVADE && this.alive[invader] === 1 && !invasionKill.has(invader);
            invasionKill.set(victim, invader);
            ctx.invasions.push([invader, victim, counter]);
            if (counter) {
                if (!invasionKill.has(invader) && this.alive[invader] === 1) {
                    invasionKill.set(invader, victim);
                    ctx.invasions.push([victim, invader, true]);
                }
            }
        }
        for (const v of invasionKill.keys()) if (this.alive[v] === 1) this.alive[v] = 0;
        // 掠夺：幸存杀手取尸体半数（env2_v24.py:539-548）；余下经 8b 入池；
        // 入侵缴获（含反咬击杀）付 attack_reward
        for (const [victim, killer] of invasionKill) {
            if (this.alive[killer] === 1 && this.alive[victim] === 0) {
                const take = 0.5 * Math.max(this.res[victim], 0);
                this.res[killer] += take;
                ctx.lootTo[killer] += take;
                this.res[victim] = 0.5 * Math.max(this.res[victim], 0);
                ctx.rewards[killer] += this.attack_reward; // v2.4：入侵击杀赏金
                ctx.attackCount[killer]++; // TS-only 诊断
            }
        }
        // dead_now 装配（env2.py:537-540）+ 死因（541-547：mutual > invade > strike 覆盖序）
        for (const v of [...ctx.kills.keys(), ...invasionKill.keys()]) {
            if (this.alive[v] === 0) ctx.deadNow[v] = 1;
        }
        for (const v of ctx.kills.keys()) this.death_cause[v] = "strike";
        for (const [victim] of invasionKill) this.death_cause[victim] = "invade";
        for (const [v, , mutual] of ctx.invasions) if (mutual) this.death_cause[v] = "mutual";
    }

    /** 阶段 8b：尸体结算（env2.py:587-592）——一切余量归自由池（Axiom 2） */
    private stageSettlement(ctx: TickCtx): void {
        for (let v = 0; v < this.n; v++) {
            if (ctx.deadNow[v] === 1) {
                this.free_pool += Math.max(this.res[v], 0);
                this.res[v] = 0;
            }
        }
    }

    // ---- Task 9 实装 ----

    /**
     * 阶段 6：观测（env2_v24.py:562-572）——v2.4 显式目标（锁定）否则最近已知
     * （与 STRIKE 同协议）；精确 tech/res；下刻反曝光。
     */
    private stageObserve(ctx: TickCtx): void {
        const n = this.n;
        for (let i = 0; i < n; i++) {
            if (ctx.eff[i] !== A_OBSERVE || !this.alive[i]) continue;
            let j = this._targets.get(i) ?? -1;
            if (
                j < 0 ||
                !(this.known[i * n + j] && this.alive[j] === 1) ||
                this.in_domain[j] === 1 ||
                this.domain_windup[j] === 1
            )
                j = this.argminRow(ctx.knownAliveD, i, n); // 最近已知兜底
            if (Number.isFinite(ctx.knownAliveD[i * n + j])) {
                this.observed[i * n + j] = 1;
                this.pending_counter.push(i); // to see is to be seen
            }
        }
    }

    /** 阶段 7+8：发展/爆炸 + 流失/饿死（env2.py:557-585） */
    private stageEconomy(ctx: TickCtx): void {
        const n = this.n;
        // 7) 发展：0.05·(1−tech/1e6)（域内 ×0.2）
        for (let i = 0; i < n; i++) {
            if (ctx.eff[i] === A_DEVELOP && this.alive[i]) {
                let g = this.develop_rate * (1 - this.tech[i] / this.tech_cap);
                if (this.in_domain[i]) g *= this.bd_growth_mult;
                this.tech[i] += g;
            }
        }
        // peak_tech：活者刷新（env2.py:566）
        for (let i = 0; i < n; i++) {
            if (this.alive[i]) this.peak_tech[i] = Math.max(this.peak_tech[i], this.tech[i]);
        }
        // 爆炸：p=0.01（域内 ×0.1）；u 阵恒调用；乘数仅在命中时抽取
        const boomU = this.rng.uniformArray(n);
        const boomList: number[] = [];
        for (let i = 0; i < n; i++) {
            if (!this.alive[i]) continue;
            let p = this.p_explosion;
            if (this.in_domain[i]) p *= this.bd_explosion_mult;
            if (boomU[i] < p) boomList.push(i);
        }
        if (this.p_explosion > 0 && boomList.length > 0) {
            const mult = this.rng.uniformArray(boomList.length, 1.6, 2.2);
            for (let k = 0; k < boomList.length; k++) this.tech[boomList[k]] *= mult[k];
        }
        // 8) 流失 p=0.02，损 U[0.5,2] 入池（不可为负两次）；res≤0 饿死（域内照常）
        const depU = this.rng.uniformArray(n);
        const depList: number[] = [];
        for (let i = 0; i < n; i++) {
            if (this.alive[i] && depU[i] < this.p_deplete) depList.push(i);
        }
        if (depList.length > 0) {
            const loss = this.rng.uniformArray(depList.length, this.deplete_lo, this.deplete_hi);
            let sum = 0;
            for (let k = 0; k < depList.length; k++) {
                const l = Math.min(loss[k], Math.max(this.res[depList[k]], 0));
                this.res[depList[k]] -= l;
                sum += l;
            }
            this.free_pool += sum;
        }
        for (let i = 0; i < n; i++) {
            if (this.alive[i] && this.res[i] <= 0) {
                this.alive[i] = 0;
                this.death_cause[i] = "starve";
                ctx.deadNow[i] = 1;
            }
        }
    }

    /**
     * 阶段 9：奖励（env2_v24.py:611-629）——死亡 −deathPenalty；发展 +softsign·tech/(1+a|tech|)
     * + v2.4 奖励臂：DEVELOP 刻 + resRewardScale·res（>0 才加；c/d 臂）。
     * 同时填 rewardDetail 的 techTerm/resAtReward（TS-only 诊断）。
     */
    private stageRewards(ctx: TickCtx): void {
        const n = this.n;
        for (let i = 0; i < n; i++) {
            if (ctx.deadNow[i]) ctx.rewards[i] -= this.death_penalty;
        }
        for (let i = 0; i < n; i++) {
            if (ctx.eff[i] === A_DEVELOP && this.alive[i]) {
                const techTerm = this.tech[i] / (1 + this.softsign_a * Math.abs(this.tech[i]));
                ctx.rewards[i] += this.softsign_reward_scale * techTerm;
                if (this.res_reward_scale > 0) ctx.rewards[i] += this.res_reward_scale * this.res[i];
                ctx.techTerm[i] = techTerm; // TS-only 诊断
                ctx.resAtReward[i] = this.res[i];
            }
        }
    }

    /** 阶段 10：内生出生（env2.py:224-254 调用点 :606） */
    private stageBirths(ctx: TickCtx): void {
        this.activatePendingSpawns(ctx.deadNow);
    }

    /**
     * v2.4 无界内生出生（env2_v24.py:249-275）：恒恰一个预滚额；池攒够即生
     * （每刻至多 1 个、最靠前空槽）。**无科技继承**：出生科技恒 tech_spawn_lo
     * （config 钉 lo=hi=1.0——同起跑线；v2.3 的 P25–P75 抽取已删，每出生少 1 个 RNG 值）。
     *
     * **槽复用（对实验的明示偏离，用户 2026-10-14 指令"取消 36 上限"；仅
     * cfg.slotReuse 世界开启——在线多生命世界）**：全部未生槽耗尽后取最靠前
     * **已死**槽重生——玩家死亡→再排队的出生供给保障。缺省世界（金标准回放/
     * 单机/统计等价）保持 env2_v24 硬上限（实证：trace-main-s1/d 等暴力轨迹
     * 会耗尽 36 槽——复用若默认开启即破坏奇偶）。复用 = 恒星位置不动（"恒星
     * 位置永不变"字面保持）、零额外 RNG（消耗序与新生同构）、认知态全清
     * （见 reuseSlot）。
     */
    activatePendingSpawns(deadNow?: Uint8Array): void {
        if (this.pending_spawns.length === 0) return;
        if (this.free_pool < this.pending_spawns[0]) return;
        let slot = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.spawn_tick[i] > 1e8) {
                slot = i;
                break;
            }
        }
        if (slot < 0 && this.cfg.slotReuse === true) {
            for (let i = 0; i < this.n; i++) {
                // 跳过本刻刚死者（deadNow，评审 Critical #2）：同刻死亡+复用会把
                // 死者立即顶生——死因被 reuseSlot 抹空、上层以 alive 判死读到新住客
                // ⇒ 吞死/幻影席位共享/重演漂移砖化。推迟一刻复用，语义零损。
                if (deadNow?.[i] === 1) continue;
                if (this.spawn_tick[i] <= 1e8 && this.alive[i] === 0) {
                    slot = i;
                    break;
                }
            }
            if (slot < 0) return; // 36 槽全数在场存活——无出生供给
            this.reuseSlot(slot);
        }
        if (slot < 0) return;
        const spawnRes = this.pending_spawns.shift() as number;
        this.pending_spawns.push(this.rng.uniformRange(this.res_min, this.res_max)); // 再预滚下一个
        this.tech[slot] = this.tech_spawn_lo;
        this.res[slot] = spawnRes;
        this.free_pool -= spawnRes;
        this.spawn_tech[slot] = this.tech[slot];
        this.spawn_res[slot] = spawnRes;
        this.spawn_tick[slot] = this.t + 1;
        this.alive[slot] = 1;
        this.birth_log.push([this.t + 1, slot, spawnRes]);
    }

    /**
     * 复用槽的旧主认知态清除（仅复用路径可达）。行+列都清：他人对旧主的
     * known/observed 一并失效——旧主死亡时感知层已发 log.dark，新主是全新文明；
     * first_detect_tick/peak_tech 一并归位。pending_reveal/pending_counter 中
     * 引用本槽的条目全清：防死者死后揭发新主（延迟公开落在新主头上）、幽灵反曝光。
     */
    private reuseSlot(j: number): void {
        const n = this.n;
        for (let i = 0; i < n; i++) {
            this.known[i * n + j] = 0;
            this.known[j * n + i] = 0;
            this.observed[i * n + j] = 0;
            this.observed[j * n + i] = 0;
            this.first_detect_tick[i * n + j] = -1;
            this.first_detect_tick[j * n + i] = -1;
        }
        this.public_[j] = 0;
        this.in_domain[j] = 0;
        this.domain_windup[j] = 0;
        this.death_cause[j] = "";
        this.last_action[j] = A_SILENT;
        this.peak_tech[j] = this.tech_spawn_lo;
        this._invaders.delete(j);
        this._targets.delete(j);
        this.pending_reveal = this.pending_reveal.filter((e) => e[1] !== j);
        this.pending_counter = this.pending_counter.filter((i) => i !== j);
    }

    /** Q7（env2.py:219-222）：槽位仅在 spawn_tick 后激活——保留 parity（resolve 不引用） */
    get exists(): Uint8Array {
        const out = new Uint8Array(this.n);
        for (let i = 0; i < this.n; i++) out[i] = this.alive[i] && this.t >= this.spawn_tick[i] ? 1 : 0;
        return out;
    }

    /** 终局标志（resolve 置位；done 后任何提交都会抛错） */
    get done(): boolean {
        return this._done;
    }
}
