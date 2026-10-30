"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LogEntryView } from "@/lib/solo/view";
import type { QueueResponse, StateResponse } from "./types";

const TOKEN_KEY = "df.online.token";
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * 在线模式客户端会话（计划客户端节）：
 * - **自动入队**：挂载即带 localStorage token 调 POST /queue（"排队即入场"）；
 * - 轮询 = 递归 setTimeout（禁 setInterval）：控制台 2s / 大厅 5s / 入侵模态开 1.5s /
 *   终局遮罩期 5s；`document.hidden` 暂停，回前台立即补一发；
 * - **日志条数游标**：`since` = 客户端累计数（出生锚定后）；每响应增量合并，
 *   数组每次新建（React Compiler 的 EventLog memo 契约）；
 * - 404 unknown-token：缓存态有终局 → **保留终局遮罩等手动"再排一次"**
 *   （旧世界已滚动删除）；否则自动重排（剪除/滚动）；
 * - 提交响应不带日志增量（协议约定）——事件由下一次轮询送达；stale-tick 静默
 *   （立即轮询追平）；连续失败 ≥2 显示 offline 横幅（数据保持旧态）；
 * - 入侵倒计时按 (tick, invader) 键冻结——防每 1.5s 轮询重启 CSS 倒计时条。
 */
export interface LastAction {
    action: number;
    target: number;
}

/**
 * 刻末安全网决策（纯函数，页面消费；走查回归 2026-10-28）：
 * 本窗无提交 ∧ 姿态非静默 ∧ 可行动 ∧ **本刻尚未发过** → 返回定时器延迟（≥0，
 * deadline−SAFETY_NET_MS 减当前时刻）；否则 null（不武装）。
 *
 * **firedTick 刻号闸是风暴修复的核心**：安全网 effect 的重排由渲染驱动（每次
 * 轮询响应、每次 setLastAction 都重渲染），若无刻号闸，过触发点后每次重排都
 * 即发一个 fire-and-forget POST——POST 响应不落地循环就不止（dev 慢响应下
 * 无界：lock busy 500 刷屏 + 浏览器 HTTP/1.1 连接池耗尽）。每刻恰一次提交，
 * 失败也不重试（刻照常到点结算，未提交=静默；下一窗重新武装）。
 */
export function safetyNetDelay(opts: {
    nowMs: number;
    tickEndsAtMs: number;
    tick: number;
    submission: { action: number; target: number } | null;
    canAct: boolean;
    stance: "silent" | "develop";
    firedTick: number;
}): number | null {
    if (opts.tickEndsAtMs == null) return null;
    if (opts.firedTick === opts.tick) return null; // 刻号闸：本刻已发
    if (opts.stance === "silent") return null; // 服务端缺省即静默——不发包
    if (opts.submission !== null) return null;
    if (!opts.canAct) return null;
    return Math.max(0, opts.tickEndsAtMs - SAFETY_NET_MS - opts.nowMs);
}

/** 安全网提前量：先于任何 now≥截止 的惰性结算请求落地（无竞态） */
export const SAFETY_NET_MS = 2000;

export interface OnlineSession {
    /** 最新成功响应（boot 前 null） */
    state: StateResponse | null;
    /** 客户端累计日志（渲染用——响应内 view.log 仅为增量） */
    log: LogEntryView[];
    offline: boolean;
    /** 入侵倒计时（首次见到该 (tick, invader) 时的当刻剩余秒） */
    invasionLeft: number;
    /** 最近一次成功提交的动作（回车 = 重复上刻；新世界重置） */
    lastAction: LastAction | null;
    submitAction: (action: number, target: number) => void;
    /** 5=黑域 | 6=反咬 | -1=明确保持原动作（协议兼容；页面模态"取消"已改本地关闭） */
    submitRechoice: (action: number) => void;
    /** 离开排队（仅产前；页面自行导航走） */
    leave: () => Promise<void>;
    /** 再排一次（终局遮罩按钮 / unknown-token 自动兜底） */
    requeue: () => Promise<void>;
}

export function useOnlineWorld(): OnlineSession {
    const [state, setState] = useState<StateResponse | null>(null);
    const [log, setLog] = useState<LogEntryView[]>([]);
    const [offline, setOffline] = useState(false);
    const [invasionLeft, setInvasionLeft] = useState(0);
    const [lastAction, setLastAction] = useState<LastAction | null>(null);

    const stateRef = useRef<StateResponse | null>(null);
    const tokenRef = useRef<string | null>(null);
    const cursorRef = useRef(0);
    const failuresRef = useRef(0);
    const invasionKeyRef = useRef("");
    const detachedRef = useRef(false); // 旧世界已删 + 终局遮罩在手：停请求等手动重排

    const apply = useCallback((resp: StateResponse) => {
        if (resp.kind === "console") {
            setLog((prev) => {
                const next = prev.length === 0 ? resp.view.log : [...prev, ...resp.view.log];
                cursorRef.current = next.length;
                return next;
            });
            const inv = resp.view.invasion;
            if (inv !== null) {
                const key = `${resp.timing.tick}-${inv.invaderId}`;
                if (invasionKeyRef.current !== key) {
                    invasionKeyRef.current = key;
                    setInvasionLeft(Math.max(0, resp.timing.remainingSeconds));
                }
            }
        }
        stateRef.current = resp;
        setState(resp);
        failuresRef.current = 0;
        setOffline(false);
    }, []);

    const fail = useCallback(() => {
        failuresRef.current += 1;
        if (failuresRef.current >= 2) setOffline(true);
    }, []);

    const requeue = useCallback(async () => {
        try {
            const res = await fetch("/api/online/queue", {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify({ token: tokenRef.current }),
            });
            if (!res.ok) {
                fail();
                return;
            }
            const q = (await res.json()) as QueueResponse;
            localStorage.setItem(TOKEN_KEY, q.token);
            tokenRef.current = q.token;
            detachedRef.current = false;
            setLastAction(null);
            cursorRef.current = 0;
            setLog([]);
            invasionKeyRef.current = "";
            apply(q.state); // join 响应 = 出生锚定全量日志（since=0 语义）
        } catch {
            fail();
        }
    }, [apply, fail]);

    const pollOnce = useCallback(async () => {
        if (detachedRef.current) return; // 终局遮罩在手：静默等待手动重排
        const token = tokenRef.current;
        if (token === null) return;
        try {
            const res = await fetch(
                `/api/online/state?token=${encodeURIComponent(token)}&since=${cursorRef.current}`,
            );
            if (res.status === 404) {
                const s = stateRef.current;
                if (s !== null && s.kind === "console" && s.view.end !== null) {
                    detachedRef.current = true; // 保留缓存终局遮罩
                    return;
                }
                await requeue();
                return;
            }
            if (!res.ok) {
                fail();
                return;
            }
            apply((await res.json()) as StateResponse);
        } catch {
            fail();
        }
    }, [apply, fail, requeue]);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cadence = (): number => {
            const s = stateRef.current;
            if (s === null) return 3000;
            if (s.kind === "console") {
                if (s.view.invasion !== null) return 1500;
                if (s.view.end !== null) return 5000; // 终局遮罩期：低频，等重排
                return 2000;
            }
            return 5000; // lobby
        };

        const tick = async () => {
            if (stopped) return;
            const hidden = typeof document !== "undefined" && document.hidden;
            if (!hidden) await pollOnce();
            if (!stopped) timer = setTimeout(() => void tick(), cadence());
        };

        const onVisible = () => {
            if (document.hidden || timer === null) return;
            clearTimeout(timer);
            void tick();
        };

        void (async () => {
            const stored =
                typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
            tokenRef.current = stored;
            await requeue(); // 自动入队：带 token 幂等重入；无 token = 新发
            if (!stopped) timer = setTimeout(() => void tick(), cadence());
        })();

        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            if (timer !== null) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [pollOnce, requeue]);

    const post = useCallback(
        async (path: string, body: Record<string, unknown>): Promise<void> => {
            const token = tokenRef.current;
            const s = stateRef.current;
            if (token === null || s === null) return;
            try {
                const res = await fetch(path, {
                    method: "POST",
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ token, ...body }),
                });
                if (res.status === 404) {
                    await requeue();
                    return;
                }
                if (!res.ok) return; // stale-tick 等：静默——下一次轮询追平
                apply((await res.json()) as StateResponse);
            } catch {
                fail();
            }
        },
        [apply, fail, requeue],
    );

    const submitAction = useCallback(
        (action: number, target: number) => {
            const s = stateRef.current;
            if (s === null || s.kind !== "console") return;
            // 值稳定：同值不换对象——避免恒新对象触发重渲染（安全网风暴的放大器
            // 之一，2026-10-28 回归）
            setLastAction((prev) =>
                prev !== null && prev.action === action && prev.target === target
                    ? prev
                    : { action, target },
            );
            void post("/api/online/action", {
                tick: s.timing.tick,
                action,
                target,
            });
        },
        [post],
    );

    const submitRechoice = useCallback(
        (action: number) => {
            const s = stateRef.current;
            if (s === null || s.kind !== "console") return;
            void post("/api/online/rechoice", { tick: s.timing.tick, action });
        },
        [post],
    );

    const leave = useCallback(async () => {
        const token = tokenRef.current;
        if (token === null) return;
        try {
            await fetch(`/api/online/queue?token=${encodeURIComponent(token)}`, {
                method: "DELETE",
            });
        } catch {
            /* 离开失败不阻塞导航——token 留存，回来即幂等重入 */
        }
    }, []);

    return {
        state,
        log,
        offline,
        invasionLeft,
        lastAction,
        submitAction,
        submitRechoice,
        leave,
        requeue,
    };
}
