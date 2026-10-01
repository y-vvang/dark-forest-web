import { GATES } from "@/lib/mock";
import { useI18n, type MessageKey, type TParams } from "@/i18n";

import { Panel } from "./panel";

/**
 * The 3×3 action grid (DESIGN.md §10.4): row 1 existence, row 2
 * intel·sanctuary·plunder, row 3 violence. Targeting actions arm a
 * target-selection mode instead of firing immediately; every disabled
 * button states its gate reason inline.
 */
export type ActionId =
    | "silent"
    | "develop"
    | "broadcast"
    | "observe"
    | "domain"
    | "invade"
    | "strike"
    | "strikeWeak"
    | "strikeStrong";

interface ActionDef {
    id: ActionId;
    name: MessageKey;
    sub: MessageKey;
    /** needs an explicit target on the chart */
    targets?: boolean;
}

/** display order fixed by DESIGN.md §10.4 */
const ORDER: ActionDef[] = [
    { id: "silent", name: "actions.silent", sub: "actions.silent.sub" },
    { id: "develop", name: "actions.develop", sub: "actions.develop.sub" },
    { id: "broadcast", name: "actions.broadcast", sub: "actions.broadcast.sub" },
    { id: "observe", name: "actions.observe", sub: "actions.observe.sub" },
    { id: "domain", name: "actions.domain", sub: "actions.domain.sub" },
    { id: "invade", name: "actions.invade", sub: "actions.invade.sub", targets: true },
    { id: "strike", name: "actions.strike", sub: "actions.strike.sub", targets: true },
    { id: "strikeWeak", name: "actions.strikeWeak", sub: "actions.strikeWeak.sub" },
    { id: "strikeStrong", name: "actions.strikeStrong", sub: "actions.strikeStrong.sub" },
];

type Block = { reason: MessageKey; params?: TParams } | null;

/** env gates (config_v23.yaml) evaluated in the env's own order of checks */
function gateOf(
    id: ActionId,
    tech: number,
    res: number,
    hasKnown: boolean,
): Block {
    switch (id) {
        case "broadcast":
            return tech > GATES.broadcastTech || res > GATES.broadcastRes
                ? null
                : { reason: "actions.disabled.broadcast" };
        case "observe":
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > GATES.observeTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: GATES.observeTech } };
        case "domain":
            return tech > GATES.domainTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: GATES.domainTech } };
        case "strike":
        case "strikeWeak":
        case "strikeStrong":
            if (!hasKnown) return { reason: "actions.disabled.noKnown" };
            return tech > GATES.strikeTech
                ? null
                : { reason: "actions.disabled.tech", params: { v: GATES.strikeTech } };
        case "invade":
            return hasKnown ? null : { reason: "actions.disabled.noKnown" };
        default:
            return null;
    }
}

export function ActionGrid({
    tech,
    res,
    hasKnown,
    lastAction,
    armed,
    onArm,
    onAction,
}: {
    tech: number;
    res: number;
    hasKnown: boolean;
    /** last resolved action, highlighted amber */
    lastAction: ActionId | null;
    /** the armed targeting action, highlighted red */
    armed: ActionId | null;
    onArm: (id: ActionId) => void;
    onAction: (id: ActionId) => void;
}) {
    const { t } = useI18n();

    return (
        <Panel title={t("match.actions")}>
            <div className="grid grid-cols-3 gap-2">
                {ORDER.map((def) => {
                    const blocked = gateOf(def.id, tech, res, hasKnown);
                    const isArmed = armed === def.id;
                    const isLast = lastAction === def.id;
                    return (
                        <button
                            key={def.id}
                            type="button"
                            disabled={blocked !== null}
                            onClick={() =>
                                def.targets === true ? onArm(def.id) : onAction(def.id)
                            }
                            className={`flex min-h-16 flex-col items-start justify-center gap-1 rounded-panel border px-2 py-1 text-left ${
                                isArmed
                                    ? "border-lethal bg-raised"
                                    : isLast
                                      ? "border-self"
                                      : blocked !== null
                                        ? "border-subtle opacity-40"
                                        : "border-subtle hover:border-strong hover:bg-raised"
                            }`}
                        >
                            <span
                                className={`text-sm font-bold ${
                                    isArmed
                                        ? "text-lethal"
                                        : isLast
                                          ? "text-self"
                                          : "text-ink"
                                }`}
                            >
                                {t(def.name)}
                            </span>
                            <span className="text-xs text-dim">
                                {blocked !== null
                                    ? t(blocked.reason, blocked.params)
                                    : t(def.sub)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </Panel>
    );
}
