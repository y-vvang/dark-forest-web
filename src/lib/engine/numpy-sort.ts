/**
 * numpy 1.26.4 `np.argsort(kind='quicksort')` 标量路径的逐位 TS 移植。
 *
 * 源：numpy/core/src/npysort/quicksort.cpp 的 `aquicksort_`（introsort：
 * 中位数三选主元 Hoare 分区 + 深度上限转 heapsort + ≤15 段插入排序）与
 * npysort_heapsort.h 的 `aheapsort_`（1-based 堆）。Windows 轮子（MSVC 构建）
 * 按 quicksort.cpp:74-84 禁用 SIMD 分派 → 走此标量路径（本机权威录制环境）。
 *
 * 用途：env.obs() 近邻块的 `order = np.argsort(big)`（env2_v24.py:327）。候选不足
 * 3 时掩码行特征取排序后第 k 位文明的旗标——**inf 平局序必须逐位一致**（平局序
 * 非稳定非索引序，见 numpy-sort.test.ts）。Tag::less（float64）= 严格小于；本数据
 * 无 NaN（距离与 inf），-0.0 不出现（hypot ≥ 0）。
 */

/** npy_get_msb：最高置位比特索引（36 → 5）；cdepth = msb*2（quicksort.cpp:235） */
function npyGetMsb(n: number): number {
    return 31 - Math.clz32(n);
}

/** aheapsort_（npysort_heapsort.h:71）——深度耗尽回退；n=36 实际不可达（cdepth=10 ≫ 深度上限 ~5） */
function aheapsort(v: Float64Array, idx: Int32Array, pl: number, pr: number): void {
    let n = pr - pl + 1;
    // C: a = tosort - 1（1-based 视图）；h[k] ≡ idx[pl + k - 1]。
    // i/j 为函数作用域（C 原文 `npy_intp *a, i, j, l, tmp;`）——循环出口后仍被使用
    const h = new Int32Array(n + 1); // h[0] 弃用
    for (let k = 1; k <= n; k++) h[k] = idx[pl + k - 1];
    const less = (a: number, b: number) => v[h[a]] < v[h[b]];
    let i: number;
    let j: number;

    for (let l = n >> 1; l > 0; --l) {
        const tmp = h[l];
        for (i = l, j = l << 1; j <= n; ) {
            if (j < n && less(j, j + 1)) j += 1;
            if (v[tmp] < v[h[j]]) {
                h[i] = h[j];
                i = j;
                j += j;
            } else break;
        }
        h[i] = tmp;
    }

    for (; n > 1; ) {
        const tmp = h[n];
        h[n] = h[1];
        n -= 1;
        for (i = 1, j = 2; j <= n; ) {
            if (j < n && less(j, j + 1)) j++;
            if (v[tmp] < v[h[j]]) {
                h[i] = h[j];
                i = j;
                j += j;
            } else break;
        }
        h[i] = tmp;
    }
    for (let k = 1; k <= pr - pl + 1; k++) idx[pl + k - 1] = h[k];
}

/**
 * aquicksort_（quicksort.cpp:222-307）：按 v 值升序返回 0..n-1 的排列。
 * 常量与控制流逐行对齐：SMALL_QUICKSORT=15；栈序（先推大侧、迭代小侧）；
 * 分区中位三选 + 主元藏尾（pm↔pr-1）+ Hoare 双向扫描 + 主元归位（pi↔pr-1）。
 */
export function numpyArgsort(v: Float64Array): Int32Array {
    const n = v.length;
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    if (n <= 1) return idx;

    let pl = 0;
    let pr = n - 1;
    let cdepth = npyGetMsb(n) * 2;
    const stackPl: number[] = [];
    const stackPr: number[] = [];
    const stackD: number[] = [];

    const swap = (a: number, b: number) => {
        const t = idx[a];
        idx[a] = idx[b];
        idx[b] = t;
    };

    for (;;) {
        if (cdepth < 0) {
            aheapsort(v, idx, pl, pr);
            // goto stack_pop
            if (stackPl.length === 0) break;
            pr = stackPr.pop() as number;
            pl = stackPl.pop() as number;
            cdepth = stackD.pop() as number;
            continue;
        }
        while (pr - pl > 15) {
            /* quicksort partition（quicksort.cpp:242-284） */
            const pm = pl + ((pr - pl) >> 1);
            if (v[idx[pm]] < v[idx[pl]]) swap(pm, pl);
            if (v[idx[pr]] < v[idx[pm]]) swap(pr, pm);
            if (v[idx[pm]] < v[idx[pl]]) swap(pm, pl);
            const vp = v[idx[pm]];
            let pi = pl;
            let pj = pr - 1;
            swap(pm, pj);
            for (;;) {
                do {
                    ++pi;
                } while (v[idx[pi]] < vp);
                do {
                    --pj;
                } while (vp < v[idx[pj]]);
                if (pi >= pj) break;
                swap(pi, pj);
            }
            const pk = pr - 1;
            swap(pi, pk);
            /* push largest partition on stack */
            if (pi - pl < pr - pi) {
                stackPl.push(pi + 1);
                stackPr.push(pr);
                pr = pi - 1;
            } else {
                stackPl.push(pl);
                stackPr.push(pi - 1);
                pl = pi + 1;
            }
            stackD.push(--cdepth);
        }

        /* insertion sort（quicksort.cpp:286-296） */
        for (let i = pl + 1; i <= pr; ++i) {
            const vi = idx[i];
            const vp = v[vi];
            let j = i;
            let k = i - 1;
            while (j > pl && vp < v[idx[k]]) {
                idx[j--] = idx[k--];
            }
            idx[j] = vi;
        }

        /* stack_pop */
        if (stackPl.length === 0) break;
        pr = stackPr.pop() as number;
        pl = stackPl.pop() as number;
        cdepth = stackD.pop() as number;
    }
    return idx;
}
