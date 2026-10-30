/**
 * 世界存储接口（计划存储节）。单 JSON 记录 + 指针/版本键 + 锁 + 独立心跳键——
 * 心跳不入记录：入记录则每次轮询都写全记录并撞版本，击穿只读轮询与带宽预算
 * （计划级裁定）。
 *
 * writeRecord 的 CAS 语义：写入方先把 rec.v 置为 expectedVersion+1；
 * store 校验库内当前版本（缺席视作 0）=== expectedVersion，相等才存深拷贝。
 * touchHeartbeat 的实现应设 TTL（防孤儿键累积——免费档数据量敏感）。
 */
import { constants } from "@/lib/constants";

import { MemoryStore } from "./memory-store";
import { UpstashStore } from "./upstash-store";
import type { WorldIndex, WorldRecord } from "./types";

export interface WorldStore {
    readIndex(): Promise<WorldIndex | null>;
    writeIndex(idx: WorldIndex): Promise<void>;
    clearIndex(): Promise<void>;

    readRecord(worldId: string): Promise<WorldRecord | null>;
    /** false = 库内版本与 expectedVersion 不符（陈旧写者，弃写） */
    writeRecord(worldId: string, rec: WorldRecord, expectedVersion: number): Promise<boolean>;
    deleteRecord(worldId: string): Promise<void>;

    /** 严格 SET NX PX 语义：锁存在即 false（TTL 过期视为可夺） */
    acquireLock(worldId: string, lockToken: string, ttlMs: number): Promise<boolean>;
    /** Lua compare-and-del 语义：仅持有者能释放 */
    releaseLock(worldId: string, lockToken: string): Promise<void>;

    touchHeartbeat(token: string, nowMs: number): Promise<void>;
    /** 与 tokens 对齐的批量读（缺席 = null） */
    readHeartbeats(tokens: readonly string[]): Promise<(number | null)[]>;

    /** 清空全部在线命名空间（idx/记录/锁/心跳），返回清除的条目数——手动 dev
     *  卫生命令（`bun run purge:online`）；生产世界跨部署持久，永不清。 */
    purgeAll(): Promise<number>;
}

let cachedStore: WorldStore | null = null;

/**
 * 运行时 store 选择：有 Upstash env → 生产路径（dev 有 .env.local 同样走真实
 * Redis）；dev 无 env → 内存预览；产线缺 env → 显式抛错（绝不静默丢世界）。
 */
export function getStore(): WorldStore {
    if (cachedStore !== null) return cachedStore;
    const url = constants.upstashRedisRestUrl;
    const token = constants.upstashRedisRestToken;
    if (url !== "" && token !== "") cachedStore = new UpstashStore(url, token);
    else if (process.env.NODE_ENV === "production")
        throw new Error("ERR_ENV_VAR_MISSING: UPSTASH_REDIS_REST_URL");
    else cachedStore = new MemoryStore();
    return cachedStore;
}
