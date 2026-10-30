/**
 * 世界记录的纯操作（不触存储、不触引擎）：窗口开关、截止、剪队、体积告警。
 * ticks[i] 覆盖窗口 i+1——条目的 nextActions 是"本窗口收集的下一刻提交"，
 * rechoices 是"本刻（飞行中）受害者的重选"（计划时序模型）。
 */
import { HEARTBEAT_FACTOR, RECORD_WARN_BYTES, TICK_SECONDS } from "./config";
import type { TickEntry, WorldRecord } from "./types";

function openEntry(nowMs: number): TickEntry {
    return { beganAtMs: nowMs, endedAtMs: null, nextActions: {}, rechoices: {} };
}

function openIndexOf(rec: WorldRecord): number {
    const last = rec.ticks.length - 1;
    if (last >= 0 && rec.ticks[last].endedAtMs === null) return last;
    return -1;
}

export function newWorldRecord(worldId: string, seed: number, nowMs: number): WorldRecord {
    return {
        v: 1,
        worldId,
        seed,
        status: "running",
        tickSeconds: TICK_SECONDS,
        createdAtMs: nowMs,
        endedAtMs: null,
        ticks: [openEntry(nowMs)],
        queue: [],
        joinedAt: {},
        seats: {},
    };
}

export function openWindow(rec: WorldRecord, nowMs: number): void {
    if (openIndexOf(rec) !== -1) throw new Error("record: previous window still open");
    rec.ticks.push(openEntry(nowMs));
}

export function closeWindow(rec: WorldRecord, nowMs: number): void {
    const i = openIndexOf(rec);
    if (i === -1) throw new Error("record: no open window");
    rec.ticks[i].endedAtMs = nowMs;
}

/** 开窗截止时刻（beganAtMs + tickSeconds×1000） */
export function currentDeadline(rec: WorldRecord): number {
    const i = openIndexOf(rec);
    if (i === -1) throw new Error("record: no open window");
    return rec.ticks[i].beganAtMs + rec.tickSeconds * 1000;
}

/** 开窗条目（服务写入提交/重选的目标）；无开窗即抛 */
export function openTickEntry(rec: WorldRecord): TickEntry {
    const i = openIndexOf(rec);
    if (i === -1) throw new Error("record: no open window");
    return rec.ticks[i];
}

/** 已结算刻数 = 已关窗条目数 */
export function resolvedTickCount(rec: WorldRecord): number {
    let n = 0;
    for (const t of rec.ticks) if (t.endedAtMs !== null) n++;
    return n;
}

/** 飞行中刻号 = 已结算刻数 + 1 */
export function inFlightTick(rec: WorldRecord): number {
    return resolvedTickCount(rec) + 1;
}

/** 剪除超时/无心跳的排队 token（保序）；返回被剪 token。严格大于阈值才剪。
 *  已入座者（seats 有配对）永不剪——花名册保序是 FIFO 配对重演的前提。 */
export function pruneQueue(
    rec: WorldRecord,
    heartbeats: readonly (number | null)[],
    nowMs: number,
): string[] {
    const cutoff = HEARTBEAT_FACTOR * rec.tickSeconds * 1000;
    const removed: string[] = [];
    const kept: string[] = [];
    rec.queue.forEach((token, i) => {
        if (rec.seats[token] !== undefined) {
            kept.push(token); // 已入座：跳过（活性与剪除无关）
            return;
        }
        const hb = heartbeats[i] ?? null;
        if (hb === null || nowMs - hb > cutoff) removed.push(token);
        else kept.push(token);
    });
    rec.queue = kept;
    for (const token of removed) delete rec.joinedAt[token]; // 孤儿时刻一并清理
    return removed;
}

/** 记录字节数；超目标体积告警（Upstash 免费档月带宽 10GB 是真约束） */
export function assertRecordSize(rec: WorldRecord): number {
    const bytes = JSON.stringify(rec).length;
    if (bytes > RECORD_WARN_BYTES)
        console.warn(
            `[online] world record ${rec.worldId} is ${bytes} bytes (> ${RECORD_WARN_BYTES})`,
        );
    return bytes;
}
