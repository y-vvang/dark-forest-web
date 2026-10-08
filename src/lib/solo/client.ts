"use client";

/**
 * /match 装配层：op 参数解析 → 模型按需加载 → SoloMatch + ViewTracker 构造。
 * 页面组件保持瘦；此模块是唯一接触 SoloMatch 构造细节的客户端代码。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { isOpponentId } from "@/lib/opponents/catalog";
import { loadModel, type ModelWeights } from "@/lib/opponents/dqn";
import { SoloMatch } from "@/lib/solo/match";
import { ViewTracker, type MatchView } from "@/lib/solo/view";

export type LoadState =
    | { status: "redirect" } // 非法 op / 模型加载失败 → 页面层 replace /solo
    | { status: "loading" }
    | { status: "ready"; view: MatchView };

export interface MatchSession {
    state: LoadState;
    /** READY 后：提交玩家一选（ViewTracker 契约——每次提交后恰一次 update） */
    submitAction: (action: number, target: number) => void;
    /** READY 后：受入侵重选 */
    submitRechoice: (action: number) => void;
    /** READY 后：取消入侵重选（保持本刻原动作） */
    cancelRechoice: () => void;
}

export function useSoloMatch(opParam: string | null): MatchSession {
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const matchRef = useRef<SoloMatch | null>(null);
    const trackerRef = useRef<ViewTracker | null>(null);

    // 种子：会话内一次（crypto 随机；console.info 便于排障复现）
    const seed = useMemo(() => {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        const s = buf[0] >>> 1;
        console.info("[darkforest] match seed", s);
        return s;
    }, []);

    const ids = useMemo(
        () => (opParam ?? "").split(",").map((x) => x.trim()).filter((x) => x !== ""),
        [opParam],
    );

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (ids.length === 0 || ids.some((id) => !isOpponentId(id))) {
                setState({ status: "redirect" });
                return;
            }
            const modelIds = ids.filter(
                (id) => id !== "random" && id !== "df" && id !== "pacifist",
            );
            const uniqueModels = [...new Set(modelIds)];
            try {
                const list: ModelWeights[] = await Promise.all(
                    uniqueModels.map((id) => loadModel(id)),
                );
                if (cancelled) return;
                const weights = new Map(uniqueModels.map((_, i) => [list[i].arm, list[i]]));
                const match = new SoloMatch(seed, ids, weights);
                const tracker = new ViewTracker(match);
                tracker.update(); // 排队态先更新一次 → 发出 waitBirth（v23 下排队恒为 1 刻：
                // 初始池 ≥ 150−80 = 70 > 预滚上限 20，玩家必在第 1 刻出生，无中间出生可漏）
                match.start();
                matchRef.current = match;
                trackerRef.current = tracker;
                setState({ status: "ready", view: tracker.update() }); // t0 结算 → birthSelf
            } catch (err) {
                // 模型 404 等 → 回 /solo（与非法参数同路）
                console.error("[darkforest] match setup failed", err);
                if (!cancelled) setState({ status: "redirect" });
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [ids, seed]);

    /** 提交后恰一次 update（ViewTracker 消费契约） */
    const push = () => {
        const tr = trackerRef.current;
        if (tr !== null) setState({ status: "ready", view: tr.update() });
    };

    return {
        state,
        submitAction: (action, target) => {
            const m = matchRef.current;
            if (m === null) return;
            m.submitAction(action, target);
            push();
        },
        submitRechoice: (action) => {
            const m = matchRef.current;
            if (m === null) return;
            m.submitRechoice(action);
            push();
        },
        cancelRechoice: () => {
            const m = matchRef.current;
            if (m === null) return;
            m.cancelRechoice();
            push();
        },
    };
}
