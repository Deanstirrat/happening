import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "playwright-core", "playwright-extra", "puppeteer-extra-plugin-stealth", "puppeteer-extra-plugin", "@anthropic-ai/sdk"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  serverExternalPackages: ["playwright-extra", "puppeteer-extra-plugin-stealth"],
};

export default nextConfig;
