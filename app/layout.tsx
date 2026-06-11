import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import NavBarWrapper from "@/components/layout/NavBarWrapper";
import BugReportButton from "@/components/ui/BugReportButton";
import PageTracker from "@/components/analytics/PageTracker";
import Logo from "@/components/ui/Logo";
import { Suspense } from "react";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#131211",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "https://happeningsf.now"),
  title: "happening — SF Bay Area Events",
  description: "Discover what's happening around you in San Francisco and the Bay Area.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark h-full antialiased ${jakarta.variable} ${grotesk.variable}`}>
      <body className="min-h-full flex flex-col bg-background text-on-surface">
        <Suspense>
          <NavBarWrapper />
          <PageTracker />
        </Suspense>
        <main className="flex-1">{children}</main>
        <footer className="mt-auto border-t border-on-surface/10">
          <div className="py-6 px-4 sm:px-6 flex items-center justify-between text-on-surface-variant text-xs font-body max-w-screen-xl mx-auto w-full">
            <Logo className="text-sm text-on-surface" />
            <a
              href="/feature"
              className="hover:text-primary transition-colors"
            >
              feature an event
            </a>
          </div>
        </footer>
        <BugReportButton />
      </body>
    </html>
  );
}
