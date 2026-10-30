import type { ErrorCode } from "./types";

/** 在线错误：code 即线协议 ErrorCode；route 层经 errorStatus 映射 HTTP 状态 */
export class OnlineError extends Error {
    constructor(readonly code: ErrorCode) {
        super(code);
    }
}

export function parseToken(raw: string | null): string {
    if (raw === null || raw.length === 0 || raw.length > 64) throw new OnlineError("invalid-request");
    return raw;
}

/** 刻号：整数 ≥ 1（飞行中刻号，提交防陈旧校验用） */
export function parseTick(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new OnlineError("invalid-request");
    return n;
}

/** 日志游标：条数（出生锚定后的持有数），整数 ≥ 0 */
export function parseSince(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new OnlineError("invalid-request");
    return n;
}

export function errorStatus(code: ErrorCode): number {
    switch (code) {
        case "invalid-request":
        case "invalid-action":
            return 400;
        case "unknown-token":
            return 404;
        case "stale-tick":
        case "not-born":
        case "not-invaded":
            return 409;
        case "server-busy":
            return 503;
    }
}

/** 解析 JSON 请求体：空体 → {}；坏 JSON / 非对象 → invalid-request */
export async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
    const text = await req.text();
    if (text.length === 0) return {};
    try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("not an object");
        return parsed as Record<string, unknown>;
    } catch {
        throw new OnlineError("invalid-request");
    }
}

/** 必填整数字段（tick） */
export function reqTick(body: Record<string, unknown>): number {
    return parseTick(String(body.tick));
}

/** 必填整数字段（action/target 等，可为负——目标 -1 = 最近已知兜底） */
export function reqInt(body: Record<string, unknown>, key: string): number {
    const raw = body[key];
    if (raw === undefined || raw === null || !Number.isInteger(Number(raw)))
        throw new OnlineError("invalid-request");
    return Number(raw);
}
