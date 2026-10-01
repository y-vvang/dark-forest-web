import type { Metadata } from "next";

import { ClientLayout } from "@/components/client-layout";

import "./globals.css";

// Server metadata stays English regardless of locale (DESIGN.md §12).
export const metadata: Metadata = {
    title: "DARK FOREST",
    description:
        "Dark Forest — a survival strategy game faithfully ported from the v2.3-fix dark-forest multi-agent RL experiment.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="min-h-svh bg-panel font-mono text-ink antialiased">
                <ClientLayout>{children}</ClientLayout>
            </body>
        </html>
    );
}
