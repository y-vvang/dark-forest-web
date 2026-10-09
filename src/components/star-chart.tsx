

import { cameraXY } from "@/lib/solo/camera";

import { Marker, type CivLike } from "./marker";

/**
 * The world chart (DESIGN.md §10.6): DOM-rendered, never <canvas>.
 * Continuous [0,100) torus space; markers positioned by percentage.
 *
 * Camera (2026-10-09): every marker is re-anchored relative to the player's
 * fixed position — the player always sits at 50%/50%, the detection-radius
 * ring stays centered, and torus neighbors appear at their shortest-path
 * offset (across-the-seam civs render near the player, not at the far edge).
 * Markers landing in the boundary band are clamped ON the edge line — fully
 * visible (replaces the v0.2 clip simplification). The decorative starfield
 * does not move (dust, not world objects). Camera math lives in
 * @/lib/solo/camera (shared with the perception log's relative coordinates).
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
    const cam = (civ: CivLike): CivLike => {
        if (self === undefined) return civ; // 排队幽灵：尚无自身，不变换
        const { x, y } = cameraXY(civ.x, civ.y, self.x, self.y);
        return { ...civ, x, y }; // 自身：wrap(0)=0 → 恒 (50,50)
    };

    return (
        <div
            className={`starfield relative aspect-square w-full overflow-hidden rounded-panel border border-subtle bg-void ${className}`}
        >
            {self !== undefined && (
                <div
                    aria-hidden
                    className="pointer-events-none absolute rounded-full border border-dashed border-faint"
                    style={{
                        left: "50%",
                        top: "50%",
                        width: "60%",
                        height: "60%",
                        transform: "translate(-50%, -50%)",
                    }}
                />
            )}
            {civs.map((civ) => (
                <Marker
                    key={civ.id}
                    civ={cam(civ)}
                    selectable={selectableIds.includes(civ.id)}
                    ping={pingIds.includes(civ.id)}
                    onPick={onPick}
                />
            ))}
        </div>
    );
}
