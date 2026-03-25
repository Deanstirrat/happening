import { BaseScraper } from "./base";
import type { ScrapedEvent } from "./base";

/**
 * Meetup GraphQL API (public events, no auth required for discovery).
 * If auth is required, set MEETUP_API_KEY env var (OAuth bearer token).
 */
export class MeetupScraper extends BaseScraper {
  readonly sourceSlug = "meetup";
  private readonly GQL_URL = "https://www.meetup.com/gql";

  async scrape(): Promise<ScrapedEvent[]> {
    const events: ScrapedEvent[] = [];
    let cursor: string | null = null;
    const MAX_PAGES = 10;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    };

    if (process.env.MEETUP_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.MEETUP_API_KEY}`;
    }

    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `
        query GetEventsByLocation($lat: Float!, $lon: Float!, $radius: Float!, $after: String) {
          results: upcomingEvents(
            filter: { lat: $lat, lon: $lon, radius: $radius, doConsolidateEvents: false }
            input: { first: 50, after: $after }
          ) {
            edges {
              node {
                id
                title
                dateTime
                endTime
                description
                eventUrl
                isOnline
                going
                venue {
                  name
                  address
                  city
                  lat
                  lon
                }
                group {
                  name
                  urlname
                }
                feeSettings {
                  amount
                  currency
                }
                imageUrl
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const variables: Record<string, unknown> = {
        lat: 37.7749,
        lon: -122.4194,
        radius: 30.0,
        after: cursor,
      };

      try {
        const res: Response = await fetch(this.GQL_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, variables }),
        });

        if (!res.ok) {
          console.error(`[meetup] GraphQL error ${res.status}`);
          break;
        }

        const json: any = await res.json();
        const data: any = json.data?.results;
        if (!data) {
          console.error("[meetup] Unexpected response shape:", JSON.stringify(json).slice(0, 200));
          break;
        }

        for (const edge of data.edges ?? []) {
          const node = edge.node;
          const startDate = new Date(node.dateTime);
          if (isNaN(startDate.getTime())) continue;

          const endDate = node.endTime ? new Date(node.endTime) : undefined;

          const price =
            node.feeSettings?.amount != null && node.feeSettings.amount > 0
              ? `$${node.feeSettings.amount} ${node.feeSettings.currency}`
              : "Free";
          const isFree = !node.feeSettings?.amount || node.feeSettings.amount === 0;

          events.push({
            externalId: node.id,
            title: node.title,
            description: node.description?.slice(0, 1000),
            startDate,
            endDate,
            venueName: node.venue?.name ?? (node.isOnline ? "Online" : undefined),
            venueAddress: node.venue
              ? `${node.venue.address}, ${node.venue.city}`
              : undefined,
            latitude: node.venue?.lat ?? undefined,
            longitude: node.venue?.lon ?? undefined,
            price,
            isFree,
            imageUrl: node.imageUrl,
            sourceUrl: node.eventUrl,
            tags: [node.group?.name?.toLowerCase() ?? "meetup"].filter(Boolean),
          });
        }

        if (!data.pageInfo?.hasNextPage) break;
        cursor = data.pageInfo.endCursor;
      } catch (err: any) {
        console.error("[meetup] Error:", err.message);
        break;
      }
    }

    return events;
  }
}
