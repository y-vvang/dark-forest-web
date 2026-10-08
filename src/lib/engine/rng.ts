/**
 * 引擎随机接口 —— 方法集 = env2.py 实际消耗的全量（核对过：env2.py 只调
 * uniform(…)/choice(…)，见 docs/game-mechanics.md §2.1）。
 *
 * 三个实现：
 * - GameRng     运行时：sfc32 种子化（splitmix64 扩展），同种子=同局逐位复现；
 * - ScriptedRng 单测：按序原样吐出脚本值（脚本值即终值，不做 lo/hi 缩放），
 *                   队列尽后 uniform 族返回 fill、choice 按 fill 索引候选；consumed 按值计数；
 * - ReplayRng   金标准回放：按序弹出录制条目，断言方法+参数一致（Task 14 接 base64）。
 */
import type { TraceDraw } from "./types-rng";

export interface Rng {
    /** [0,1) 半开 */
    uniform(): number;
    uniformRange(lo: number, hi: number): number;
    /** size 个值；矩阵按行主序平铺（录制端 args.size 可为 [r,c]，回放按乘积校验） */
    uniformArray(size: number, lo?: number, hi?: number): Float64Array;
    choice(candidates: readonly number[]): number;
}

// ------------------------------------------------------------------ seedOf
const MASK64 = (1n << 64n) - 1n;

function splitmix64(x: bigint): bigint {
    x = (x + 0x9e3779b97f4a7c15n) & MASK64;
    let z = x;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
}

/** FNV-1a 32-bit over the domain tag */
function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** 种子派生（game-mechanics.md §2.2）：splitmix64(matchSeed ^ tag(domain)) → 32bit */
export function seedOf(matchSeed: number, domain: string): number {
    const mixed = splitmix64((BigInt(matchSeed >>> 0) ^ BigInt(fnv1a(domain))) & MASK64);
    return Number(mixed & 0xffffffffn) >>> 0;
}

// ------------------------------------------------------------------ GameRng
function sfc32(a: number, b: number, c: number, d: number): () => number {
    return () => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        const t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        const out = (t + d) | 0;
        c = (c + out) | 0;
        return out >>> 0;
    };
}

export class GameRng implements Rng {
    private next32: () => number;

    constructor(seeds: number[]) {
        const words: number[] = [];
        for (const s of seeds) {
            const z = splitmix64(BigInt(s >>> 0));
            words.push(Number(z & 0xffffffffn) >>> 0, Number((z >> 32n) & 0xffffffffn) >>> 0);
        }
        while (words.length < 4) words.push(0x9e3779b9);
        this.next32 = sfc32(words[0], words[1], words[2], words[3]);
    }

    /** 53 位构造：a·2²¹ + (b>>>11) ∈ [0, 2⁵³) */
    uniform(): number {
        const a = this.next32();
        const b = this.next32();
        return (a * 2097152 + (b >>> 11)) / 9007199254740992;
    }

    uniformRange(lo: number, hi: number): number {
        return lo + (hi - lo) * this.uniform();
    }

    uniformArray(size: number, lo = 0, hi = 1): Float64Array {
        const out = new Float64Array(size);
        for (let i = 0; i < size; i++) out[i] = lo + (hi - lo) * this.uniform();
        return out;
    }

    choice(candidates: readonly number[]): number {
        let idx = Math.floor(this.uniform() * candidates.length);
        if (idx >= candidates.length) idx = candidates.length - 1;
        return candidates[idx];
    }
}

// --------------------------------------------------------------- ScriptedRng
export class ScriptedRng implements Rng {
    /** 已服务的值个数（队列值 + fill 值都计） */
    consumed = 0;
    private i = 0;

    constructor(
        private queue: number[],
        private fill = 0.5,
    ) {}

    private pop(): number {
        this.consumed++;
        if (this.i < this.queue.length) return this.queue[this.i++];
        return this.fill;
    }

    uniform(): number {
        return this.pop();
    }

    uniformRange(_lo: number, _hi: number): number {
        return this.pop(); // 脚本值即终值
    }

    uniformArray(size: number, _lo?: number, _hi?: number): Float64Array {
        const out = new Float64Array(size);
        for (let k = 0; k < size; k++) out[k] = this.pop();
        return out;
    }

    choice(candidates: readonly number[]): number {
        if (this.i < this.queue.length) return this.pop(); // 原样作为被选元素
        this.consumed++;
        return candidates[Math.min(candidates.length - 1, Math.floor(this.fill * candidates.length))];
    }
}

// ----------------------------------------------------------------- ReplayRng
export { type TraceDraw };

/** 纯 atob 解码 "b64:f64:<…>"/"b64:f32:<…>"（bun/浏览器内置，不依赖 node:Buffer） */
function decodeTagged(
    tagged: string,
    size: number,
    ctx: string,
    onError: (msg: string) => void,
): Float64Array {
    const kind = tagged.slice(0, tagged.indexOf(":", 4)); // "b64:f32" | "b64:f64"
    const b64 = tagged.slice(kind.length + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const arr =
        kind === "b64:f32"
            ? new Float64Array(new Float32Array(bytes.buffer, 0, bytes.length / 4).map((x) => x))
            : new Float64Array(bytes.buffer, 0, bytes.length / 8);
    if (arr.length !== size) {
        onError(`${ctx} recorded ${arr.length} values, engine asked for ${size}`);
        return new Float64Array(size);
    }
    return arr;
}

/**
 * 金标准回放（Task 14 全量接线；本骨架支持标量/数字数组，b64:f64/f32 标记暂抛错）。
 * 每次调用断言方法与参数一致后返回录制值；失配/耗尽即测试失败。
 */
export class ReplayRng implements Rng {
    exhausted = false;
    private i = 0;

    constructor(
        private log: TraceDraw[],
        private onError: (msg: string) => void = (m) => {
            throw new Error(`ReplayRng: ${m}`);
        },
    ) {}

    private take(m: TraceDraw["m"], argsCheck: (draw: TraceDraw) => boolean, ctx: string) {
        const draw = this.log[this.i++];
        if (!draw || draw.m !== m) {
            this.onError(`#${this.i - 1} expected ${m} (${ctx}), got ${draw ? draw.m : "EOF"}`);
            return 0;
        }
        if (!argsCheck(draw)) {
            this.onError(`#${this.i - 1} ${m} args mismatch at (${ctx}): ${JSON.stringify(draw.args)}`);
            return 0;
        }
        return draw.v;
    }

    private unwrap(v: unknown, size: number, ctx: string): number | Float64Array {
        if (typeof v === "number") return v;
        if (Array.isArray(v)) {
            const arr = Float64Array.from(v);
            if (arr.length !== size) {
                this.onError(`${ctx} recorded ${arr.length} values, engine asked for ${size}`);
                return new Float64Array(size);
            }
            return arr;
        }
        if (typeof v === "string" && v.startsWith("b64:")) {
            return decodeTagged(v, size, ctx, this.onError);
        }
        this.onError(`unexpected draw value type at (${ctx})`);
        return new Float64Array(size);
    }

    uniform(): number {
        const d = this.take("uniform", (x) => x.args[2] === null, "uniform()");
        const v = this.unwrap(d, 1, "uniform()");
        return v as number;
    }

    uniformRange(lo: number, hi: number): number {
        const d = this.take(
            "uniform",
            (x) => x.args[2] === null && x.args[0] === lo && x.args[1] === hi,
            `uniformRange(${lo},${hi})`,
        );
        return this.unwrap(d, 1, `uniformRange(${lo},${hi})`) as number;
    }

    uniformArray(size: number, lo = 0, hi = 1): Float64Array {
        const d = this.take(
            "uniform",
            (x) => {
                const s = x.args[2];
                const n = s === null ? 1 : Array.isArray(s) ? s[0] * s[1] : s;
                return n === size && x.args[0] === lo && x.args[1] === hi;
            },
            `uniformArray(${size},${lo},${hi})`,
        );
        const v = this.unwrap(d, size, `uniformArray(${size})`);
        if (typeof v === "number") {
            this.onError(`uniformArray(${size}) got scalar where batch expected`);
            return new Float64Array(size);
        }
        return v;
    }

    choice(candidates: readonly number[]): number {
        const d = this.take(
            "choice",
            (x) =>
                Array.isArray(x.args[0]) &&
                x.args[0].length === candidates.length &&
                x.args[0].every((c: number, k: number) => c === candidates[k]),
            `choice(${candidates.length} cands)`,
        );
        return d as number;
    }

    /** 轨迹耗尽校验：所有录制条目恰好被消费 */
    assertExhausted(): void {
        this.exhausted = this.i === this.log.length;
        if (!this.exhausted)
            this.onError(`consumed ${this.i}/${this.log.length} draws — consumption order diverged`);
    }
}
