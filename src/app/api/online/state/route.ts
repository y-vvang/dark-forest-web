import { parseSince, parseToken } from "@/lib/online/http";
import { getOnlineService, jsonFail, jsonOk } from "@/lib/online/server";

export const dynamic = "force-dynamic";

/** 统一轮询：无 token = 大厅公开读数；有 token = 大厅/控制台/终局视图 + 日志增量 */
export async function GET(req: Request): Promise<Response> {
    try {
        const params = new URL(req.url).searchParams;
        const tokenRaw = params.get("token");
        const since = parseSince(params.get("since") ?? "0");
        const svc = getOnlineService();
        const state =
            tokenRaw === null
                ? await svc.getState(null, since)
                : await svc.getState(parseToken(tokenRaw), since);
        return jsonOk(state);
    } catch (e) {
        return jsonFail(e);
    }
}
