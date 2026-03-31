import type { NextConfig } from "next";

const nextConfig: NextConfig = {
serverExternalPackages: ["playwright", "playwright-core", "playwright-extra", "puppeteer-extra-plugin-stealth", "puppeteer-extra-plugin", "@anthropic-ai/sdk"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    qualities: [75],
    deviceSizes: [640, 750, 828, 1080, 1200],
  },
};

export default nextConfig;
