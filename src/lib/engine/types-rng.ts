/** ReplayRng 的录制条目类型（与 scripts/golden/record_golden.py 的 rngLog 元素对应） */
export interface TraceDraw {
    m: "uniform" | "choice";
    /** uniform: [lo, hi, size]（size: null=标量 | number | [rows, cols]）；choice: [候选数组] */
    args: [number, number, number | number[] | null] | [number[]];
    /** 标量 | 数字数组 | "b64:f64:<…>" | "b64:f32:<…>"（矩阵/obs 批量走 base64） */
    v: number | number[] | string;
}
