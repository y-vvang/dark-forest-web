import type { WorldIndex, WorldRecord } from "./types";
import type { WorldStore } from "./store";

/** 内存实现：单元测试与 dev 无 env 回退。深拷贝进出——与 Redis 序列化语义对齐。 */
export class MemoryStore implements WorldStore {
    private idx: WorldIndex | null = null;
    private records = new Map<string, WorldRecord>();
    private locks = new Map<string, { token: string; expiresAt: number }>();
    private heartbeats = new Map<string, number>();

    async readIndex(): Promise<WorldIndex | null> {
        return this.idx ? { ...this.idx } : null;
    }

    async writeIndex(idx: WorldIndex): Promise<void> {
        this.idx = { ...idx };
    }

    async clearIndex(): Promise<void> {
        this.idx = null;
    }

    async readRecord(worldId: string): Promise<WorldRecord | null> {
        const rec = this.records.get(worldId);
        return rec ? structuredClone(rec) : null;
    }

    async writeRecord(worldId: string, rec: WorldRecord, expectedVersion: number): Promise<boolean> {
        const cur = this.records.get(worldId);
        const curV = cur ? cur.v : 0;
        if (curV !== expectedVersion) return false;
        if (rec.v !== expectedVersion + 1)
            throw new Error(
                `MemoryStore: caller must set rec.v = expectedVersion+1 (got ${rec.v}, expected ${expectedVersion + 1})`,
            );
        this.records.set(worldId, structuredClone(rec));
        return true;
    }

    async deleteRecord(worldId: string): Promise<void> {
        this.records.delete(worldId);
    }

    async acquireLock(worldId: string, lockToken: string, ttlMs: number): Promise<boolean> {
        const cur = this.locks.get(worldId);
        if (cur && cur.expiresAt > Date.now()) return false;
        this.locks.set(worldId, { token: lockToken, expiresAt: Date.now() + ttlMs });
        return true;
    }

    async releaseLock(worldId: string, lockToken: string): Promise<void> {
        const cur = this.locks.get(worldId);
        if (cur && cur.token === lockToken) this.locks.delete(worldId);
    }

    async touchHeartbeat(token: string, nowMs: number): Promise<void> {
        this.heartbeats.set(token, nowMs);
    }

    async readHeartbeats(tokens: readonly string[]): Promise<(number | null)[]> {
        return tokens.map((t) => this.heartbeats.get(t) ?? null);
    }

    async purgeAll(): Promise<number> {
        let n = 0;
        n += this.records.size;
        n += this.heartbeats.size;
        if (this.idx !== null) n += 1;
        this.idx = null;
        this.records.clear();
        this.locks.clear();
        this.heartbeats.clear();
        return n;
    }
}
