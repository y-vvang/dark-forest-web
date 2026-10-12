/**
 * 金标准轨迹 IO（测试专用；node:zlib + node:fs 由 bun test 提供）。
 *
 * 轨迹格式见 scripts/golden/record_golden.py 文档与 docs/game-mechanics.md §4.1。
 * base64 解码在 ReplayRng（rng.ts）内用纯 atob 实现——引擎须保持浏览器安全。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import type { DarkForestEnv2 } from "./env";
import type { EnvSnapshot } from "./snapshot";
import type { TraceDraw } from "./types-rng";

const TESTDATA = join(import.meta.dir, "testdata");

export interface TracePatch {
    known?: [number, number][];
    tech?: [number, number][];
    res?: [number, number][];
    pos?: [number, number, number][];
    alive?: [number, number][];
    free_pool?: number;
    pending_spawns?: number[];
}

export interface TraceTick {
    actions: number[];
    targets: number[];
    invaded: number[];
    reObs: string | null;
    reActions: number[];
    post: {
        state: EnvSnapshot;
        obs: string;
        info: Record<string, unknown>;
        rewards: number[];
        done: boolean;
    };
}

export interface TraceFile {
    /** v2.4：cfg = 完整 env 参数（EnvConfig 同名字段；奖励臂轨迹自带 override） */
    meta: {
        seed: number;
        kinds: string[];
        agentArms: Record<string, string>;
        driver: string;
        note: string;
        cfg: import("./config").EnvConfig;
    };
    reset: { patch: TracePatch | null; state: EnvSnapshot; obs: string };
    ticks: TraceTick[];
    rngLog: TraceDraw[];
}

export function loadTrace(name: string): TraceFile {
    const raw = gunzipSync(readFileSync(join(TESTDATA, `${name}.json.gz`)));
    return JSON.parse(new TextDecoder().decode(raw)) as TraceFile;
}

export function loadStats(): { episodes: number; meanAliveFrac: number; meanKills: number; actionFreqs: number[] } {
    return JSON.parse(readFileSync(join(TESTDATA, "stats.json"), "utf8"));
}

/** reset 后的声明式补丁——与 record_golden.py 的 apply_patch 一一对应 */
export function applyPatch(env: DarkForestEnv2, patch: TracePatch): void {
    const n = env.n;
    for (const [i, j] of patch.known ?? []) env.known[i * n + j] = 1;
    for (const [i, v] of patch.tech ?? []) env.tech[i] = v;
    for (const [i, v] of patch.res ?? []) env.res[i] = v;
    for (const [x, y, z] of patch.pos ?? []) {
        env.pos[x * 2] = y;
        env.pos[x * 2 + 1] = z;
    }
    for (const [i, v] of patch.alive ?? []) env.alive[i] = v ? 1 : 0;
    if (patch.free_pool !== undefined) env.free_pool = patch.free_pool;
    if (patch.pending_spawns !== undefined) env.pending_spawns = [...patch.pending_spawns];
}

/** "b64:f32:<…>" → Float32Array（纯 atob，两端同 LE） */
export function decodeObs(tagged: string): Float32Array {
    const kind = tagged.slice(0, tagged.indexOf(":", 4));
    const b64 = tagged.slice(kind.length + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer, 0, bytes.length / 4);
}

/**
 * 浮点容忍深比较（数值 |Δ|≤tol、类型化数组逐元素、数组/对象递归、其余严格相等）。
 * 失败收集进 fails（带路径），由调用方 expect(fails.join()).toBe("") 一次断言。
 */
export function expectDeepClose(
    a: unknown,
    b: unknown,
    tol: number,
    path: string,
    fails: string[],
): void {
    if (typeof a === "number" && typeof b === "number") {
        if (!(Math.abs(a - b) <= tol)) fails.push(`${path}: ${a} != ${b}`);
        return;
    }
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
        const va = Array.from(a as unknown as ArrayLike<number>);
        const vb = Array.from(b as unknown as ArrayLike<number>);
        if (va.length !== vb.length) {
            fails.push(`${path}: length ${va.length} != ${vb.length}`);
            return;
        }
        for (let i = 0; i < va.length; i++) {
            if (!(Math.abs(va[i] - vb[i]) <= tol)) {
                fails.push(`${path}[${i}]: ${va[i]} != ${vb[i]}`);
                return;
            }
        }
        return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            fails.push(`${path}: length ${a.length} != ${b.length}`);
            return;
        }
        for (let i = 0; i < a.length; i++) expectDeepClose(a[i], b[i], tol, `${path}[${i}]`, fails);
        return;
    }
    if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
        const ka = Object.keys(a as object);
        const kb = Object.keys(b as object);
        if (ka.length !== kb.length) {
            fails.push(`${path}: key count ${ka.length} != ${kb.length}`);
            return;
        }
        for (const key of ka)
            expectDeepClose(
                (a as Record<string, unknown>)[key],
                (b as Record<string, unknown>)[key],
                tol,
                `${path}.${key}`,
                fails,
            );
        return;
    }
    if (a !== b) fails.push(`${path}: ${String(a)} != ${String(b)}`);
}
