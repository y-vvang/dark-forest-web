/**
 * 服务端装配单例（route 层共用）：真实墙钟 + 环境配置的 store。
 * 所有在线 API 响应禁缓存（CLAUDE.md 硬规则 6）。
 */
import { errorStatus, OnlineError } from "./http";
import { createOnlineService, type OnlineService } from "./service";
import { getStore } from "./store";
import type { ErrorResponse } from "./types";

let instance: OnlineService | null = null;

export function getOnlineService(): OnlineService {
    if (instance === null)
        instance = createOnlineService({ store: getStore(), clock: () => Date.now() });
    return instance;
}

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk(data: unknown): Response {
    return Response.json(data, { headers: NO_STORE });
}

/** OnlineError → 线协议状态码；未知错误 → 500（打日志，不漏内部信息） */
export function jsonFail(e: unknown): Response {
    if (e instanceof OnlineError) {
        const body: ErrorResponse = { error: e.code };
        return Response.json(body, { status: errorStatus(e.code), headers: NO_STORE });
    }
    console.error("[online]", e);
    return new Response(null, { status: 500, headers: NO_STORE });
}
