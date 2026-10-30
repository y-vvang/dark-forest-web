import { parseJsonBody, parseToken } from "@/lib/online/http";
import { getOnlineService, jsonFail, jsonOk } from "@/lib/online/server";

export const dynamic = "force-dynamic";

/** 加入/幂等重入（无 token = 新发） */
export async function POST(req: Request): Promise<Response> {
    try {
        const body = await parseJsonBody(req);
        const token =
            body.token === undefined || body.token === null
                ? undefined
                : parseToken(String(body.token));
        return jsonOk(await getOnlineService().join(token));
    } catch (e) {
        return jsonFail(e);
    }
}

/** 离开排队（仅产前；已入座为 no-op） */
export async function DELETE(req: Request): Promise<Response> {
    try {
        const token = parseToken(new URL(req.url).searchParams.get("token"));
        await getOnlineService().leave(token);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        return jsonFail(e);
    }
}
