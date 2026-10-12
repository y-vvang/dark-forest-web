/**
 * numpy 1.26.4 argsort（kind='quicksort'=introsort）标量路径的逐位锁定。
 *
 * 为什么需要逐位复刻：观测近邻块（env2_v24.py:327 order = np.argsort(big)）在候选
 * 不足 3 个时，掩码行的 tech/res/public 特征取【排序后第 k 位】的那名文明的旗标
 * （known_pair/observed 距离无关）——inf 平局序决定取谁，而 numpy introsort 的平局
 * 序非稳定非索引序（v2.4 揭露机制使 public 常见，此伪影开始影响 obs）。
 *
 * 矢量由本机权威 numpy 1.26.4（Windows 轮子，MSVC 构建禁用 SIMD 分派 → 标量
 * aquicksort_ 路径）生成：testdata/argsort-vectors.json（2005 例，含全 inf、强制
 * 平手、递增/递减、有限+inf 混合）。其他平台构建（AVX512 ArgQSort）平局序不同
 * ——语义上同为伪影，见 testdata/README 披露。
 */
import { expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { numpyArgsort } from "./numpy-sort";

interface Vec {
    v: number[];
    o: number[];
}

const VECTORS: Vec[] = JSON.parse(
    readFileSync(join(import.meta.dir, "testdata", "argsort-vectors.json"), "utf8"),
);

test("numpyArgsort reproduces numpy 1.26.4 introsort order on all golden vectors", () => {
    expect(VECTORS.length).toBeGreaterThan(2000);
    for (let k = 0; k < VECTORS.length; k++) {
        const { v, o } = VECTORS[k];
        const got = numpyArgsort(Float64Array.from(v, (x) => (x === null ? Infinity : (x as number))));
        expect([...got], `vector ${k}`).toEqual(o);
    }
});

test("numpyArgsort is a valid permutation and value-ordered (sanity)", () => {
    const v = Float64Array.from([Infinity, 5, Infinity, 3, 5, Infinity, 0]);
    const o = numpyArgsort(v);
    expect(o.length).toBe(7);
    expect(new Set([...o]).size).toBe(7);
    let prev = -Infinity;
    for (const j of o) {
        expect(v[j]).toBeGreaterThanOrEqual(prev);
        prev = v[j];
    }
});
