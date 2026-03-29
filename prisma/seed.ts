import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { PrismaClient, ScrapeType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const sources = [
  {
    slug: "foopee",
    name: "Foopee Punk List",
    url: "https://foopee.com/punk/the-list/",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "19hz",
    name: "19hz Bay Area",
    url: "https://19hz.info/eventlisting_BayArea.php",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "funcheap",
    name: "Funcheap SF",
    url: "https://sf.funcheap.com/",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "timeout",
    name: "Timeout San Francisco",
    url: "https://www.timeout.com/san-francisco/things-to-do",
    scrapeType: ScrapeType.CHEERIO,
    enabled: false,
  },
  {
    slug: "sflive",
    name: "SF Live",
    url: "https://sflive.art",
    scrapeType: ScrapeType.API,
    enabled: true,
  },
  {
    slug: "residentadvisor",
    name: "Resident Advisor SF",
    url: "https://ra.co/events/us/sanfrancisco",
    scrapeType: ScrapeType.PLAYWRIGHT,
    enabled: true,
  },
  {
    slug: "partiful",
    name: "Partiful",
    url: "https://partiful.com/explore/sf",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "luma",
    name: "Luma SF",
    url: "https://lu.ma/sf",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "songkick",
    name: "Songkick",
    url: "https://www.songkick.com",
    scrapeType: ScrapeType.API,
    enabled: false,
  },
  {
    slug: "eventbrite",
    name: "Eventbrite",
    url: "https://www.eventbrite.com/d/ca--san-francisco/events/",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "meetup",
    name: "Meetup",
    url: "https://www.meetup.com",
    scrapeType: ScrapeType.API,
    enabled: false,
  },
  {
    slug: "posh",
    name: "Posh",
    url: "https://posh.vip/explore",
    scrapeType: ScrapeType.API,
    enabled: true,
  },
  {
    slug: "bandsintown",
    name: "Bandsintown SF",
    url: "https://www.bandsintown.com/c/san-francisco-ca",
    scrapeType: ScrapeType.PLAYWRIGHT,
    enabled: true,
  },
  {
    slug: "kqed",
    name: "KQED Live Events",
    url: "https://www.kqed.org/events",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "dothebay",
    name: "DoTheBay",
    url: "https://dothebay.com/events",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "reddit-sfevents",
    name: "Reddit r/SFEvents",
    url: "https://www.reddit.com/r/SFEvents/",
    scrapeType: ScrapeType.API,
    enabled: true,
  },
  {
    slug: "badslava",
    name: "Badslava SF Trivia Nights",
    url: "https://badslava.com/san-francisco-trivia-nights.php",
    scrapeType: ScrapeType.CHEERIO,
    enabled: true,
  },
  {
    slug: "community",
    name: "Community Submissions",
    url: "https://happening.app",
    scrapeType: ScrapeType.MANUAL,
    enabled: true,
  },
  {
    slug: "instagram",
    name: "Instagram Venues",
    url: "https://www.instagram.com",
    scrapeType: ScrapeType.API,
    enabled: true,
  },
  {
    slug: "decentered",
    name: "Decentered",
    url: "https://events.decentered.org/",
    scrapeType: ScrapeType.API,
    enabled: true,
  },
];

async function main() {
  console.log("Seeding sources...");
  for (const source of sources) {
    await prisma.source.upsert({
      where: { slug: source.slug },
      update: source,
      create: source,
    });
    console.log(`  ✓ ${source.name}`);
  }
  console.log("Done.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
