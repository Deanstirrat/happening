import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/layout/NavBar";
import { Suspense } from "react";

export const metadata: Metadata = {
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
        </Suspense>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
