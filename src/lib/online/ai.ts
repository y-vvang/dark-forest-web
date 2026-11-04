import type { ModelWeights } from "@/lib/opponents/dqn";
import aClassic from "../../../public/models/a_classic.json";
import bTerminal from "../../../public/models/b_terminal.json";
import cRes from "../../../public/models/c_res.json";
import dMalintent from "../../../public/models/d_malintent.json";
import champion from "../../../public/models/champion.json";

/**
 * 服务端权重单例：v2.5 四臂 + v3.0 champion checkpoint 的构建期内联 JSON import
 * （免运行时 fs/fetch——Vercel 函数内 public/ 的 fs 可用性不担保；Next 构建期把
 * JSON 打进 server bundle，~700KB 仅驻服务端，客户端在线模式不 fetch 权重）。
 */
let cache: ReadonlyMap<string, ModelWeights> | null = null;

export function getWeights(): ReadonlyMap<string, ModelWeights> {
    if (cache === null) {
        const all = [aClassic, bTerminal, cRes, dMalintent, champion] as unknown as ModelWeights[];
        cache = new Map(all.map((w): [string, ModelWeights] => [w.arm, w]));
    }
    return cache;
}
