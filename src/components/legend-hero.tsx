import { useI18n, type MessageKey } from "@/i18n";
import type { MockCiv } from "@/lib/mock";

import { Marker } from "./marker";
import { Panel } from "./panel";

/**
 * The home-page hero (DESIGN.md §10.9): the epistemic ladder itself,
 * rendered with the real marker components. It is the visual anchor of the
 * front page and doubles as the one lesson this game needs taught.
 */
const CELLS: { civ: MockCiv; name: MessageKey; desc: MessageKey }[] = [
    {
        civ: { id: 0, x: 50, y: 50, state: "self", tech: 7.4, res: 12.5 },
        name: "legend.self",
        desc: "legend.self.desc",
    },
    {
        civ: { id: 7, x: 50, y: 50, state: "known" },
        name: "legend.known",
        desc: "legend.known.desc",
    },
    {
        civ: { id: 3, x: 50, y: 50, state: "observed", tech: 3.1, res: 8.4 },
        name: "legend.observed",
        desc: "legend.observed.desc",
    },
    {
        civ: { id: 9, x: 50, y: 50, state: "public", tech: 11.2, res: 5.9 },
        name: "legend.public",
        desc: "legend.public.desc",
    },
    {
        civ: { id: 11, x: 50, y: 50, state: "domain", tech: 6.0, res: 9.8 },
        name: "legend.domain",
        desc: "legend.domain.desc",
    },
];

export function LegendHero() {
    const { t } = useI18n();

    return (
        <Panel>
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {CELLS.map(({ civ, name, desc }) => (
                    <li
                        key={name}
                        className="flex flex-col items-center gap-2 text-center"
                    >
                        <span className="relative size-12 shrink-0">
                            <Marker civ={civ} decorative />
                        </span>
                        <span className="text-sm text-ink">{t(name)}</span>
                        <span className="text-xs text-dim">{t(desc)}</span>
                    </li>
                ))}
            </ol>
            <p className="mt-4 text-xs text-dim">{t("legend.dead")}</p>
        </Panel>
    );
}
