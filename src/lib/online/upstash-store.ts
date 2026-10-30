import { Redis } from "@upstash/redis";
import type { WorldStore } from "./store";
import type { WorldIndex, WorldRecord } from "./types";

/**
 * Upstash Redis 实现（生产路径；契约由 memory-store 单测钉住，本实现按 M4 门
 * 经真实实例手动走查验证）。键布局：idx 指针 / rec:<id> 单 JSON 记录 /
 * lock:<id> 推进锁 / hb:<token> 独立心跳（TTL 防孤儿键——免费档数据量敏感）。
 *
 * CAS 与解锁用 EVAL 单命令原子（Upstash REST 无原生 compare-and-set）——
 * 锁为主干序列化，版本校验为锁过期时的纵深。
 */

/** 库内版本（缺席=0）== expected 才整体覆写 */
const CAS_SCRIPT = `
local cur = redis.call("get", KEYS[1])
local expected = tonumber(ARGV[2])
if cur then
  local ok, obj = pcall(cjson.decode, cur)
  if not ok or obj.v ~= expected then return 0 end
else
  if expected ~= 0 then return 0 end
end
redis.call("set", KEYS[1], ARGV[1])
return 1`;

/** compare-and-del：仅持有者能释放 */
const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const IDX_KEY = "df:online:idx";
const recKey = (worldId: string) => `df:online:rec:${worldId}`;
const lockKey = (worldId: string) => `df:online:lock:${worldId}`;
const hbKey = (token: string) => `df:online:hb:${token}`;
const HB_TTL_SECONDS = 120; // > 2×TICK_SECONDS 的剪除阈，孤儿键最长滞留 2 分钟

export class UpstashStore implements WorldStore {
    private readonly redis: Redis;

    constructor(url: string, token: string) {
        // 关闭自动反序列化：GET 返回原始字符串——与 JSON.parse 及 EVAL 的裸存
        // 三方一致（默认 true 时 JSON 值被解码成对象，手动 parse 即打在对象上）
        this.redis = new Redis({ url, token, automaticDeserialization: false });
    }

    async readIndex(): Promise<WorldIndex | null> {
        const raw = await this.redis.get<string>(IDX_KEY);
        return raw === null ? null : (JSON.parse(raw) as WorldIndex);
    }

    async writeIndex(idx: WorldIndex): Promise<void> {
        await this.redis.set(IDX_KEY, JSON.stringify(idx));
    }

    async clearIndex(): Promise<void> {
        await this.redis.del(IDX_KEY);
    }

    async readRecord(worldId: string): Promise<WorldRecord | null> {
        const raw = await this.redis.get<string>(recKey(worldId));
        return raw === null ? null : (JSON.parse(raw) as WorldRecord);
    }

    async writeRecord(worldId: string, rec: WorldRecord, expectedVersion: number): Promise<boolean> {
        if (rec.v !== expectedVersion + 1)
            throw new Error(
                `UpstashStore: caller must set rec.v = expectedVersion+1 (got ${rec.v}, expected ${expectedVersion + 1})`,
            );
        const ok = await this.redis.eval(CAS_SCRIPT, [recKey(worldId)], [
            JSON.stringify(rec),
            String(expectedVersion),
        ]);
        return ok === 1;
    }

    async deleteRecord(worldId: string): Promise<void> {
        await this.redis.del(recKey(worldId));
    }

    async acquireLock(worldId: string, lockToken: string, ttlMs: number): Promise<boolean> {
        const res = await this.redis.set(lockKey(worldId), lockToken, { nx: true, px: ttlMs });
        return res === "OK";
    }

    async releaseLock(worldId: string, lockToken: string): Promise<void> {
        await this.redis.eval(UNLOCK_SCRIPT, [lockKey(worldId)], [lockToken]);
    }

    async touchHeartbeat(token: string, nowMs: number): Promise<void> {
        await this.redis.set(hbKey(token), String(nowMs), { ex: HB_TTL_SECONDS });
    }

    async readHeartbeats(tokens: readonly string[]): Promise<(number | null)[]> {
        if (tokens.length === 0) return [];
        const vals = await this.redis.mget<(string | null)[]>(...tokens.map(hbKey));
        return vals.map((v) => (v === null ? null : Number(v)));
    }

    /** 清空 df:online:* 全命名空间（dev 启动卫生；生产永不清——世界跨部署持久） */
    async purgeAll(): Promise<number> {
        const keys = await this.redis.keys("df:online:*");
        if (keys.length === 0) return 0;
        await this.redis.del(...keys);
        return keys.length;
    }
}
