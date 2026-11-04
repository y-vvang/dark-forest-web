/**
 * DarkForestEnv2 —— v2.5 的忠实 TS 移植。
 *
 * 权威源：experiment/experiment/env2_v25.py（748 行）。字段名/方法集与其一一对应
 * （_obs→obs()、_valid→valid()、_pair_dist→pairDist、_grow→_grow()）；quirk 清单见
 * docs/env-model-v23.md §0（Q1-Q16），全部照抄。
 *
 * v2.5 vs v2.4（diff 仅 104 插入/10 删除；resolve 主体逐字节相同）：
 * - OBS_DIM 36→38：9 标量（+[7] under_attack、[8] self_public）；归一化固定分母
 *   n_norm（cfg.nNorm）+ clip[0,2]（v2.4 为 /(n-1) 与 /n）。
 * - 新 env 态：under_attack（beginTick 先清后设的滑窗——重选 obs 与下一刻 obs 可见）、
 *   last_invader（不入 obs；v2b 启发式用；**复用不清除**——复生者可反咬前任入侵者）。
 * - 出生三级偏好：unborn 槽 → 死槽复用（社会态全清，**同刻死者即可复用**；不滤
 *   pending_reveal——"死者被揭露→复生者出生即 public"穿越 quirk 照抄）→ _grow 扩容
 *   （n 翻倍、新槽白纸、位置单抽；上游 last_action 覆盖 bug 见 Q16 修复）。
 * - 每次出生 peak_tech[slot] = 出生科技（逐代峰值重置，env2_v25.py:356）。
 * - 终局不变：t_max 或热寂（复用使热寂更罕见但可达）。
 *
 * v2.4 要点保留：BROADCAST_ALL / BOTHER（揭露）；OBSERVE 显式目标；出生无科技继承
 * （恒 tech_spawn_lo，每出生少 1 个 RNG 值）；奖励臂参数 res_reward_scale/attack_reward。
 *
 * 与 python 的既定差异（见 docs/game-mechanics.md §2/§3）：
 * - 随机数经构造期注入（Rng 接口 = uniform/choice 两法）；reset() 无 seed 参数。
 * - numpy 向量化 → 显式循环（36 槽规模无关紧要）。
 * - obs/valid 平铺行主序：obs[i*OBS_DIM+k]、valid[i*8+a]。
 * - TickResult.rewardDetail：TS-only 奖励诊断（游戏层扩展，非 parity——录制端无此字段）。
 * - **Q16（明示偏离）**：python resolve 尾部 `self.last_action = eff`（env2_v25.py:728）
 *   在 _grow 扩容后用旧长数组覆盖补齐数组（下刻 _obs 形状崩溃）；TS 照增长语义修复
 *   （eff 拷入新长度数组、新槽保持 A_SILENT）。增长路径实验从未触发（probe：max_alive
 *   9-12），游戏配置面板可调大预算故须正确处理。
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
    /** 槽数（v2.5 起 _grow 可变；reset 不还原 n——python 同构，游戏每局新 env） */
    n: number;
    readonly cfg: EnvConfig;
    /** v2.5 obs 归一化固定分母（env2_v25 ctor 第 2 位置参数；yaml 无此键=36.0） */
    private readonly n_norm: number;
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
    /** v2.5 滑窗：被入侵旗标（beginTick 先清后设；重选 obs 与下一刻 obs 可见） */
    under_attack: Uint8Array;
    /** v2.5：各槽最近入侵者（−1 = 无；不入 obs；**复用不清除**——照抄） */
    last_invader: Int32Array;
    in_domain: Uint8Array;
    domain_windup: Uint8Array;
    pending_reveal: ["self" | "other", number][]; // env2_v25.py 的 (kind, j)——v2.4 增 "other" 揭露
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
        this.n_norm = cfg.nNorm;
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
        this.under_attack = new Uint8Array(n);
        this.last_invader = new Int32Array(n).fill(-1);
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
        this.under_attack = new Uint8Array(n);
        this.last_invader = new Int32Array(n).fill(-1);
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
     * 38 维观测（env2_v25.py:389-434）：9 标量 + 8 上刻动作 one-hot + 3 个最近已知
     * 存活非域文明 × 7。死亡/未生行整行清零。crowd（env2_v25.py:392）为死代码，不移植。
     * v2.5：[2]/[3] 除以固定 n_norm 并 clip[0,2]（v2.4 为 /(n-1) 与 /n）；新标量
     * [7] under_attack、[8] self_public；one-hot 与近邻块整体 +2 移位。
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
            out[base + 2] = Math.fround(Math.min(2, Math.max(0, knownAlive / this.n_norm)));
            out[base + 3] = Math.fround(Math.min(2, Math.max(0, aliveCount / this.n_norm)));
            out[base + 4] = Math.fround(this.t / this.t_max);
            out[base + 5] = this.in_domain[i];
            out[base + 6] = this.domain_windup[i];
            out[base + 7] = this.under_attack[i]; // v2.5 self state
            out[base + 8] = this.public_[i]; // v2.5 self_public
            out[base + 9 + this.last_action[i]] = 1; // one-hot
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
            // [17+k]=Δx [20+k]=Δy [23+k]=d [26+k]=tech [29+k]=res [32+k]=public [35+k]=in_domain
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
                out[base + 17 + k] = Math.fround(dx / 50);
                out[base + 20 + k] = Math.fround(dy / 50);
                out[base + 23 + k] = Math.fround(d / 50);
                out[base + 26 + k] =
                    nearTech >= 0 ? Math.fround(Math.log1p(Math.max(nearTech, 0)) / LOG_REF) : -1;
                out[base + 29 + k] = Math.fround(nearRes / this.res_max);
                out[base + 32 + k] = knownPair && this.public_[j] === 1 ? 1 : 0;
                out[base + 35 + k] = 0; // Q3：in_domain 特征恒 0（×known_pair 含 ~in_domain）
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
        // v2.5 滑窗（env2_v25.py:448-450）：上一刻的 under_attack 旗标此时已被看见
        // （重选 obs + 下一刻 obs）——先清，再施加本刻入侵通知。
        this.under_attack.fill(0);
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
        // 入侵通知：受害者【当场】发现入侵者并自知被入侵（env2_v25.py:459-469——
        // under_attack/last_invader 随通知置位，beginTick 后生成的重选 obs 立即可见）
        this._invaders = new Map();
        for (const [i, j] of this._targets) {
            if (this._actions[i] === A_INVADE && this.alive[i] === 1 && this.alive[j] === 1) {
                this.known[j * n + i] = 1;
                this.first_detect_tick[j * n + i] = this.t;
                this.under_attack[j] = 1;
                this.last_invader[j] = i;
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

        // env2_v25.py:728 `self.last_action = eff`——**Q16（明示偏离）**：python 此处在
        // _grow 扩容后用旧长 eff 覆盖补齐数组（下刻 _obs 形状崩溃）；TS 照增长语义
        // 修复：按当前 n 分配，旧 eff 拷入前段，新槽保持 _grow 补的 A_SILENT。
        const la = new Int32Array(this.n).fill(A_SILENT);
        la.set(ctx.eff.subarray(0, Math.min(ctx.eff.length, this.n)));
        this.last_action = la;
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

    /** 阶段 10：内生出生（env2_v25.py:726 调用点） */
    private stageBirths(_ctx: TickCtx): void {
        this.activatePendingSpawns();
    }

    /**
     * v2.5 无界内生出生（env2_v25.py:309-359）：恒恰一个预滚额；池攒够即生
     * （每刻至多 1 个）。**无科技继承**：出生科技恒 tech_spawn_lo（config 钉
     * lo=hi=1.0——同起跑线；v2.3 的 P25-P75 抽取已删）。槽偏好三级：最靠前
     * 未生槽 → 最靠前**已死**槽复用（社会态全清见 reuseSlot；**同刻死者即可
     * 复用**——v2.5 无 deadNow 跳过；死因先于本刻 died_this_tick 装配被清空，
     * 事件流死因 "" 抵达上层，由视图层 cause.unknown 兜底）→ 全槽存活且池可
     * 负担 ⇒ `_grow` 扩容（守恒是唯一刹车）。
     */
    activatePendingSpawns(): void {
        if (this.pending_spawns.length === 0) return;
        if (this.free_pool < this.pending_spawns[0]) return;
        let slot = -1;
        for (let i = 0; i < this.n; i++) {
            if (this.spawn_tick[i] > 1e8) {
                slot = i;
                break;
            }
        }
        if (slot < 0) {
            for (let i = 0; i < this.n; i++) {
                if (this.spawn_tick[i] <= 1e8 && this.alive[i] === 0) {
                    slot = i;
                    break;
                }
            }
            if (slot >= 0) {
                this.reuseSlot(slot);
            } else {
                // v2.5.1：满员世界 + 池可负担 → 扩容（env2_v25.py:341-344）
                this._grow(this.n + 1);
                slot = this.n - 1;
            }
        }
        const spawnRes = this.pending_spawns.shift() as number;
        this.pending_spawns.push(this.rng.uniformRange(this.res_min, this.res_max)); // 再预滚下一个
        this.tech[slot] = this.tech_spawn_lo;
        this.res[slot] = spawnRes;
        this.free_pool -= spawnRes;
        this.spawn_tech[slot] = this.tech[slot];
        this.spawn_res[slot] = spawnRes;
        this.peak_tech[slot] = this.tech[slot]; // v2.5：逐代峰值在出生时重置（:356）
        this.spawn_tick[slot] = this.t + 1;
        this.alive[slot] = 1;
        this.birth_log.push([this.t + 1, slot, spawnRes]);
    }

    /**
     * 复用槽的旧主社会态清除（env2_v25.py:332-340 权威清单，仅复用路径可达）。
     * 行+列都清：他人对旧主的 known/observed 一并失效——旧主死亡时感知层已发
     * log.dark，新主是全新文明。**照抄的 v2.5 语义（勿"修复"）**：① last_invader
     * 不清——复生 df 仍可反咬前任的入侵者；② pending_reveal/pending_counter
     * 不滤——死者被揭露的延迟公开落在复生者头上（出生即 public 的信息穿越）；
     * ③ 死因清空先于本刻 died_this_tick 装配（"" 抵达事件流）。peak_tech 由
     * activatePendingSpawns 的公共路径在出生时重置。
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
        this.under_attack[j] = 0;
        this.in_domain[j] = 0;
        this.domain_windup[j] = 0;
        this.death_cause[j] = "";
        this.last_action[j] = A_SILENT;
    }

    /**
     * v2.5.1 扩容（env2_v25.py:279-307）：new_n = max(2n, min_slots)；既有槽状态
     * 原样保留，新槽白纸（未生 1e9 / 0 / False / A_SILENT / -1 / ""），新槽位置
     * **一次**批量抽取 rng.uniform(0, world, m*2)。实验从未触发（probe：max_alive
     * 9-12 < 36）；游戏配置面板可调大 resTotalBudget 故可达。python 在增长刻自身
     * 的 resolve 尾部 _obs() 即崩（Q16）——活不到 reset；TS 修复后 reset 亦自洽
     *（游戏每局新 env，路径不可达）。
     */
    private _grow(minSlots: number): void {
        const newN = Math.max(this.n * 2, Math.trunc(minSlots));
        const m = newN - this.n;
        const oldN = this.n;
        // 新槽位置：一次批量（python rng.uniform(0, world, size=(m,2)) 的平铺）
        const fresh = this.rng.uniformArray(m * 2, 0, this.world);
        const pos = new Float64Array(newN * 2);
        pos.set(this.pos);
        for (let k = 0; k < m; k++) {
            pos[(oldN + k) * 2] = fresh[k * 2];
            pos[(oldN + k) * 2 + 1] = fresh[k * 2 + 1];
        }
        this.pos = pos;
        const padF64 = (src: Float64Array, fill: number): Float64Array => {
            const out = new Float64Array(newN).fill(fill);
            out.set(src);
            return out;
        };
        const padU8 = (src: Uint8Array): Uint8Array => {
            const out = new Uint8Array(newN);
            out.set(src);
            return out;
        };
        const padI32 = (src: Int32Array, fill: number): Int32Array => {
            const out = new Int32Array(newN).fill(fill);
            out.set(src);
            return out;
        };
        const pad2U8 = (src: Uint8Array): Uint8Array => {
            const out = new Uint8Array(newN * newN);
            for (let i = 0; i < oldN; i++)
                for (let j = 0; j < oldN; j++) out[i * newN + j] = src[i * oldN + j];
            return out;
        };
        const pad2I32 = (src: Int32Array): Int32Array => {
            const out = new Int32Array(newN * newN).fill(-1);
            for (let i = 0; i < oldN; i++)
                for (let j = 0; j < oldN; j++) out[i * newN + j] = src[i * oldN + j];
            return out;
        };
        this.spawn_tick = padF64(this.spawn_tick, 10 ** 9);
        this.tech = padF64(this.tech, 0);
        this.res = padF64(this.res, 0);
        this.spawn_tech = padF64(this.spawn_tech, 0);
        this.spawn_res = padF64(this.spawn_res, 0);
        this.peak_tech = padF64(this.peak_tech, 0);
        this.alive = padU8(this.alive);
        this.known = pad2U8(this.known);
        this.observed = pad2U8(this.observed);
        this.public_ = padU8(this.public_);
        this.under_attack = padU8(this.under_attack);
        this.in_domain = padU8(this.in_domain);
        this.domain_windup = padU8(this.domain_windup);
        this.first_detect_tick = pad2I32(this.first_detect_tick);
        this.last_action = padI32(this.last_action, A_SILENT);
        this.last_invader = padI32(this.last_invader, -1);
        for (let k = 0; k < m; k++) this.death_cause.push("");
        this.n = newN;
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
