import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/layout/NavBar";
import BugReportButton from "@/components/ui/BugReportButton";
import PageTracker from "@/components/analytics/PageTracker";
import { Suspense } from "react";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "https://happening.so"),
  title: "happening — SF Bay Area Events",
  description: "Discover what's happening around you in San Francisco and the Bay Area.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-on-surface">
        <Suspense>
          <NavBar />
          <PageTracker />
        </Suspense>
        <main className="flex-1">{children}</main>
        <footer className="mt-auto py-6 px-4 sm:px-6 flex items-center justify-between text-on-surface-variant text-xs font-body max-w-screen-xl mx-auto w-full">
          <span className="font-headline font-bold text-sm text-on-surface">happening</span>
          <a
            href="/feature"
            className="hover:text-on-surface transition-colors"
          >
            feature an event
          </a>
        </footer>
        <BugReportButton />
      </body>
    </html>
  );
}
