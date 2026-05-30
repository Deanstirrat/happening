import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://happening.so";

  const events = await prisma.event.findMany({
    where: {
      status: "PUBLISHED",
      startDate: { gte: new Date() },
    },
    select: { id: true, updatedAt: true },
    orderBy: { startDate: "asc" },
  });

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: `${base}/events`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/map`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/submit`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
  ];

  const eventRoutes: MetadataRoute.Sitemap = events.map((e) => ({
    url: `${base}/events/${e.id}`,
    lastModified: e.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...eventRoutes];
}
