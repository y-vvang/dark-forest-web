"use client";

import Image from "next/image";

import { useI18n } from "@/i18n";
import { BrandLink, TopBar } from "@/components/top-bar";

import { placeFixedPopover, useAutoPopover } from "@/components/use-auto-popover";

export default function NotFoundPage() {
    const { t } = useI18n();
    const { anchorRef, popoverRef, pinned, togglePinned, hoverHandlers } =
            useAutoPopover(placeFixedPopover);

    return (
        <div
            onClick={togglePinned}
            {...hoverHandlers}
            className="flex min-h-svh flex-col"
        >
            <TopBar left={<BrandLink />} right={<h1 className="text-base text-ink">{t("nav.notFound.desc")}</h1>} />
            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
                <button
                    type="button"
                    aria-label={t("nav.notFound.desc")}
                    aria-expanded={pinned}
                    className="absolute top-1/2 left-1/2 -translate-1/2 group p-1"
                >
                    <Image
                        src="/icon.svg"
                        alt=""
                        loading="eager"
                        width={404}
                        height={404}
                    />
                </button>
                <button
                    ref={anchorRef}
                    aria-hidden
                    className="absolute top-1/2 left-1/2 invisible"
                />
                <div
                    ref={popoverRef}
                    popover="auto"
                    className="marker-popover rounded-panel border border-subtle bg-panel p-3"
                >
                    <p className="tnum text-xl text-dim">{`${t("nav.notFound")} · ${t("legend.self")}`}</p>
                    <p className="mt-1 text-2xl text-dim">{t("popover.noIntel")}</p>
                </div>
            </main>
        </div>
    );
}
