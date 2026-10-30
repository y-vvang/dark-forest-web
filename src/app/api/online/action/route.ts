import { parseJsonBody, parseToken, reqInt, reqTick } from "@/lib/online/http";
import { getOnlineService, jsonFail, jsonOk } from "@/lib/online/server";

export const dynamic = "force-dynamic";

/** 提交下一刻动作（后写覆盖至刻截止；全员提交触发快进） */
export async function POST(req: Request): Promise<Response> {
    try {
        const body = await parseJsonBody(req);
        const token = parseToken(String(body.token ?? ""));
        const tick = reqTick(body);
        const action = reqInt(body, "action");
        const target = reqInt(body, "target");
        return jsonOk(await getOnlineService().submitAction(token, tick, action, target));
    } catch (e) {
        return jsonFail(e);
    }
}
