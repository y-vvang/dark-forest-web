import type { Metadata } from "next";

import { ClientLayout } from "@/components/client-layout";

import "./globals.css";

// Server metadata stays English regardless of locale (DESIGN.md §12).
export const metadata: Metadata = {
    title: {
        default: "DARK FOREST",
        template: "%s | DARK FOREST"
    },
    description:
        "Dark Forest — a survival strategy game faithfully ported from the v2.3-fix dark-forest multi-agent RL experiment.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html>
            <head>
                <link rel="shortcut icon" href="/icons/favicon.ico" />
                <link rel="icon" sizes="96x96" href="/icons/favicon-96x96.png" />
                <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
            </head>
            <body className="min-h-svh bg-panel font-mono text-ink antialiased">
                <ClientLayout>{children}</ClientLayout>
            </body>
        </html>
    );
}
