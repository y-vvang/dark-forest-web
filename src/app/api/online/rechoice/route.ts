import { parseJsonBody, parseToken, reqInt, reqTick } from "@/lib/online/http";
import { getOnlineService, jsonFail, jsonOk } from "@/lib/online/server";

export const dynamic = "force-dynamic";

/** 入侵重选：5 = 声明黑域 | 6 = 反咬 | -1 = 明确保持原动作 */
export async function POST(req: Request): Promise<Response> {
    try {
        const body = await parseJsonBody(req);
        const token = parseToken(String(body.token ?? ""));
        const tick = reqTick(body);
        const action = reqInt(body, "action");
        return jsonOk(await getOnlineService().submitRechoice(token, tick, action));
    } catch (e) {
        return jsonFail(e);
    }
}
