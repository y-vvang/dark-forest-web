/**
 * 实例级世界缓存 + 全局推进锁（计划存储节）。
 *
 * 缓存以 (worldId, 版本) 命中——轮询只付 1 次 idx 微型 GET；全量读+重演仅在版本
 * 变更/冷实例发生（Upstash 免费档月带宽 10GB 是真约束）。
 * 单例世界 ⇒ 全局一把锁覆盖 spawn/advance/rollover（免计划草案的独立 spawn 锁——
 * 竞争面更小，2026-10-13 裁定）。
 */
import { LOCK_TTL_MS } from "./config";
import type { DriverState } from "./driver";
import type { WorldStore } from "./store";
import type { WorldRecord } from "./types";

export interface WorldCtx {
    rec: WorldRecord;
    state: DriverState;
    /** 持有记录的库内版本（CAS 期望值） */
    version: number;
}

const cache = new Map<string, WorldCtx>();

export function cachedCtx(worldId: string, version: number): WorldCtx | undefined {
    const hit = cache.get(worldId);
    return hit !== undefined && hit.version === version ? hit : undefined;
}

export function putCtx(ctx: WorldCtx): void {
    cache.set(ctx.rec.worldId, ctx);
}

export function dropCtx(worldId: string): void {
    cache.delete(worldId);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 锁包装：fn = 持锁执行；busy = 等待 waitMs 仍拿不到锁时的回退。
 * 轮询传 waitMs=0（锁忙即服务当前缓存态——最终一致，下次轮询追上）；
 * 变更类操作传 LOCK_WAIT_MS（提交须赶在刻截止前落地）。
 * 锁等待用真实墙钟（Date.now）——测试时钟是游戏钟，不应驱动重试节律。
 */
export async function withLock<T>(
    store: WorldStore,
    lockId: string,
    fn: () => Promise<T>,
    busy: () => Promise<T>,
    waitMs: number,
): Promise<T> {
    const token = `lock-${Math.random().toString(36).slice(2)}`;
    const until = Date.now() + waitMs;
    for (;;) {
        if (await store.acquireLock(lockId, token, LOCK_TTL_MS)) {
            try {
                return await fn();
            } finally {
                await store.releaseLock(lockId, token);
            }
        }
        if (Date.now() >= until) return busy();
        await sleep(25);
    }
}
