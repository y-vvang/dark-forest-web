import Link from "next/link";

import { useI18n, type MessageKey } from "@/i18n";
import type { EndView } from "@/lib/solo/match";

/** 死因四值（end.kind==="dead" 时 cause 已收窄出空串） */
const CAUSE_KEY = {
    starve: "cause.starve",
    strike: "cause.strike",
    invade: "cause.invade",
    mutual: "cause.mutual",
} as const satisfies Record<"starve" | "strike" | "invade" | "mutual", MessageKey>;

type DeadCause = keyof typeof CAUSE_KEY;

function isDeadCause(c: string): c is DeadCause {
    return c === "starve" || c === "strike" || c === "invade" || c === "mutual";
}

/**
 * End-of-match overlay (DESIGN.md §10.8). No last-man-standing victory
 * exists in this world — surviving to tick 250 IS the win. Third state
 * (2026-10-02): the player died before their own birth (world heat death).
 * `advised`（2026-10-10 模型参谋）：用过即披露一行——AI 辅助 = 非独立生存（诚实标记）。
 * `onAgain`（2026-10-13 在线模式）：提供时以回调钮替代 /solo 链接（在线 = 再排一次
 * 入下一个世界；单人默认行为不变）。
 */
export function EndOverlay({
    end,
    advised,
    tMax,
    onAgain,
    againLabel,
}: {
    end: EndView;
    advised?: boolean;
    tMax?: number;
    onAgain?: () => void;
    againLabel?: MessageKey;
}) {
    const { t } = useI18n();

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4">
            <div className="w-full max-w-md rounded-panel border border-strong bg-panel p-6">
                {end.kind === "dead" ? (
                    <>
                        <h2 className="text-xl text-lethal">{t("end.dead.title")}</h2>
                        <p className="tnum mt-2 text-base text-dim">
                            {t("end.dead.cause", {
                                cause: t(isDeadCause(end.cause) ? CAUSE_KEY[end.cause] : "cause.starve"),
                            })}
                        </p>
                        <p className="tnum text-base text-dim">
                            {t("end.dead.survived", { ticks: end.ticks })}
                        </p>
                        <p className="tnum text-base text-dim">
                            {t("end.stats", { kills: end.kills, loot: end.loot.toFixed(1) })}
                        </p>
                    </>
                ) : end.kind === "won" ? (
                    <>
                        <h2 className="text-xl text-self">{t("end.alive.title")}</h2>
                        <p className="tnum mt-2 text-base text-dim">
                            {t("end.alive.body", { t: tMax ?? 250, n: end.nAlive })}
                        </p>
                    </>
                ) : (
                    <>
                        <h2 className="text-xl text-dim">{t("end.unborn.title")}</h2>
                        <p className="mt-2 text-base text-dim">{t("end.unborn.body")}</p>
                    </>
                )}
                {advised === true && (
                    <p className="mt-3 text-xs text-faint">{t("end.advisorUsed")}</p>
                )}

                <div className="mt-6 grid gap-2">
                    {onAgain !== undefined ? (
                        <button
                            type="button"
                            onClick={onAgain}
                            className="rounded-panel bg-self px-3 py-2 text-center text-base font-bold text-panel"
                        >
                            {t(againLabel ?? "online.requeue")}
                        </button>
                    ) : (
                        <Link
                            href="/solo"
                            className="rounded-panel bg-self px-3 py-2 text-center text-base font-bold text-panel"
                        >
                            {t("end.again")}
                        </Link>
                    )}
                    <Link
                        href="/"
                        className="rounded-panel border border-subtle px-3 py-2 text-center text-base text-dim hover:border-strong hover:text-ink"
                    >
                        {t("end.home")}
                    </Link>
                </div>
            </div>
        </div>
    );
}
