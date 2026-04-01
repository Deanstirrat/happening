import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "playwright-core", "playwright-extra", "puppeteer-extra-plugin-stealth", "puppeteer-extra-plugin", "@anthropic-ai/sdk"],
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    qualities: [75],
    deviceSizes: [640, 750, 828, 1080, 1200],
  },
};

export default nextConfig;
