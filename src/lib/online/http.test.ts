import { expect, test } from "bun:test";

import {
    errorStatus,
    OnlineError,
    parseJsonBody,
    parseSince,
    parseTick,
    parseToken,
    reqInt,
    reqTick,
} from "./http";

function code(fn: () => unknown): string {
    try {
        fn();
    } catch (e) {
        expect(e).toBeInstanceOf(OnlineError);
        return (e as OnlineError).code;
    }
    throw new Error("expected throw");
}

test("parseToken: accepts sane tokens, rejects missing/empty/oversize", () => {
    expect(parseToken("abc123XYZ")).toBe("abc123XYZ");
    expect(code(() => parseToken(null))).toBe("invalid-request");
    expect(code(() => parseToken(""))).toBe("invalid-request");
    expect(code(() => parseToken("x".repeat(65)))).toBe("invalid-request");
});

test("parseTick / parseSince: integer parsing", () => {
    expect(parseTick("3")).toBe(3);
    expect(parseSince("12")).toBe(12);
    expect(parseSince("0")).toBe(0);
    expect(code(() => parseTick("x"))).toBe("invalid-request");
    expect(code(() => parseTick("0"))).toBe("invalid-request"); // 刻号从 1 起
    expect(code(() => parseTick("-2"))).toBe("invalid-request");
    expect(code(() => parseSince("-1"))).toBe("invalid-request");
    expect(code(() => parseSince("abc"))).toBe("invalid-request");
});

test("errorStatus: code → HTTP status mapping", () => {
    expect(errorStatus("invalid-request")).toBe(400);
    expect(errorStatus("invalid-action")).toBe(400);
    expect(errorStatus("unknown-token")).toBe(404);
    expect(errorStatus("stale-tick")).toBe(409);
    expect(errorStatus("not-born")).toBe(409);
    expect(errorStatus("not-invaded")).toBe(409);
});

const post = (body: string) => new Request("http://x/api", { method: "POST", body });

async function acode(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (e) {
        expect(e).toBeInstanceOf(OnlineError);
        return (e as OnlineError).code;
    }
    throw new Error("expected throw");
}

test("parseJsonBody: empty → {}; object → passed through; bad JSON / non-object → 400", async () => {
    expect(await parseJsonBody(post(""))).toEqual({});
    expect(await parseJsonBody(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await acode(() => parseJsonBody(post("{bad")))).toBe("invalid-request");
    expect(await acode(() => parseJsonBody(post("[1,2]")))).toBe("invalid-request");
    expect(await acode(() => parseJsonBody(post("null")))).toBe("invalid-request");
});

test("reqTick / reqInt: integer field extraction from parsed body", () => {
    expect(reqTick({ tick: "3" })).toBe(3);
    expect(reqTick({ tick: 3 })).toBe(3);
    expect(code(() => reqTick({ tick: "x" }))).toBe("invalid-request");
    expect(code(() => reqTick({}))).toBe("invalid-request");
    expect(reqInt({ target: -1 }, "target")).toBe(-1); // 目标允许 -1（最近已知兜底）
    expect(code(() => reqInt({ target: "x" }, "target"))).toBe("invalid-request");
    expect(code(() => reqInt({}, "target"))).toBe("invalid-request");
});

test("errorStatus: server-busy → 503 (lock contention is retryable overload, not client error)", () => {
    expect(errorStatus("server-busy")).toBe(503);
});
