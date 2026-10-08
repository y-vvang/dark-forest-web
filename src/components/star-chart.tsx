

import { Marker, type CivLike } from "./marker";

/**
 * The world chart (DESIGN.md §10.6): DOM-rendered, never <canvas>.
 * Continuous [0,100) torus space; markers positioned by percentage;
 * the self detection radius is a 60%-wide dashed circle (30/100).
 * Edge behavior is clip, no wrap ghosts (v0.2 simplification).
 *
 * Markers are always inspectable (hover/click detail popover); `selectableIds`
 * marks the civs that may be locked as an explicit strike/invade target.
 */
export function StarChart({
    civs,
    selectableIds = [],
    pingIds = [],
    onPick,
    className = "",
}: {
    civs: CivLike[];
    /** civs that may be locked as an explicit strike/invade target */
    selectableIds?: number[];
    /** civs playing the new-contact ping this render */
    pingIds?: number[];
    onPick?: (civ: CivLike) => void;
    className?: string;
}) {
    const self = civs.find((civ) => civ.state === "self");

    return (
        <div
            className={`starfield relative aspect-square w-full overflow-hidden rounded-panel border border-subtle bg-void ${className}`}
        >
            {self !== undefined && (
                <div
                    aria-hidden
                    className="pointer-events-none absolute rounded-full border border-dashed border-faint"
                    style={{
                        left: `${self.x}%`,
                        top: `${self.y}%`,
                        width: "60%",
                        height: "60%",
                        transform: "translate(-50%, -50%)",
                    }}
                />
            )}
            {civs.map((civ) => (
                <Marker
                    key={civ.id}
                    civ={civ}
                    selectable={selectableIds.includes(civ.id)}
                    ping={pingIds.includes(civ.id)}
                    onPick={onPick}
                />
            ))}
        </div>
    );
}
