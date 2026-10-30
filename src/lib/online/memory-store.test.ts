import { expect, test } from "bun:test";

import { MemoryStore } from "./memory-store";
import { newWorldRecord } from "./record";
import type { WorldRecord } from "./types";

function rec(v: number): WorldRecord {
    const r = newWorldRecord("w1", 42, 0);
    r.v = v;
    return r;
}

test("index round-trips and clears", async () => {
    const s = new MemoryStore();
    expect(await s.readIndex()).toBeNull();
    await s.writeIndex({ worldId: "w1", v: 3 });
    expect(await s.readIndex()).toEqual({ worldId: "w1", v: 3 });
    await s.clearIndex();
    expect(await s.readIndex()).toBeNull();
});

test("writeRecord creates at expectedVersion 0; reads are deep copies", async () => {
    const s = new MemoryStore();
    expect(await s.writeRecord("w1", rec(1), 0)).toBe(true);
    const stored = await s.readRecord("w1");
    expect(stored?.v).toBe(1);
    stored!.queue.push("mutated");
    expect((await s.readRecord("w1"))?.queue).toEqual([]);
});

test("writeRecord rejects stale expectedVersion, accepts matching", async () => {
    const s = new MemoryStore();
    await s.writeRecord("w1", rec(1), 0);
    const r2 = rec(2);
    r2.queue = ["a"];
    expect(await s.writeRecord("w1", r2, 5)).toBe(false);
    expect((await s.readRecord("w1"))?.queue).toEqual([]);
    expect(await s.writeRecord("w1", r2, 1)).toBe(true);
    expect((await s.readRecord("w1"))?.v).toBe(2);
    expect((await s.readRecord("w1"))?.queue).toEqual(["a"]);
});

test("creation with nonzero expectedVersion fails", async () => {
    const s = new MemoryStore();
    expect(await s.writeRecord("w1", rec(2), 1)).toBe(false);
    expect(await s.readRecord("w1")).toBeNull();
});

test("deleteRecord removes the record", async () => {
    const s = new MemoryStore();
    await s.writeRecord("w1", rec(1), 0);
    await s.deleteRecord("w1");
    expect(await s.readRecord("w1")).toBeNull();
});

test("lock: exclusive acquire, token-guarded release", async () => {
    const s = new MemoryStore();
    expect(await s.acquireLock("w1", "tokA", 5000)).toBe(true);
    expect(await s.acquireLock("w1", "tokB", 5000)).toBe(false);
    await s.releaseLock("w1", "tokB"); // 错 token：无效
    expect(await s.acquireLock("w1", "tokC", 5000)).toBe(false);
    await s.releaseLock("w1", "tokA");
    expect(await s.acquireLock("w1", "tokC", 5000)).toBe(true);
});

test("lock expiry frees the lock", async () => {
    const s = new MemoryStore();
    expect(await s.acquireLock("w1", "tokA", 30)).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(await s.acquireLock("w1", "tokB", 5000)).toBe(true);
});

test("heartbeats: touch then batch-read aligned with nulls", async () => {
    const s = new MemoryStore();
    await s.touchHeartbeat("t1", 111);
    await s.touchHeartbeat("t2", 222);
    expect(await s.readHeartbeats(["t1", "t3", "t2"])).toEqual([111, null, 222]);
});

test("purgeAll: clears every namespace and returns the entry count (manual dev hygiene)", async () => {
    const s = new MemoryStore();
    await s.writeIndex({ worldId: "w1", v: 3 });
    const rec = newWorldRecord("w1", 42, 0);
    rec.queue.push("tok1");
    rec.joinedAt["tok1"] = 0;
    expect(await s.writeRecord("w1", rec, 0)).toBe(true);
    await s.touchHeartbeat("tok1", 123);
    await s.acquireLock("w1", "tokA", 5000);
    expect(await s.purgeAll()).toBe(3); // idx + record + heartbeat（锁不计条目）
    expect(await s.readIndex()).toBeNull();
    expect(await s.readRecord("w1")).toBeNull();
    expect(await s.readHeartbeats(["tok1"])).toEqual([null]);
    expect(await s.acquireLock("w1", "tokB", 5000)).toBe(true); // 锁也被清
});
