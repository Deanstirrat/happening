import { EventbriteScraper } from "./eventbrite";

export class SpotlightComedyScraper extends EventbriteScraper {
  readonly sourceSlug = "spotlightcomedy";
  protected override readonly BASE_URLS = [
    "https://www.eventbrite.com/o/spotlight-comedy-62788201173/",
  ];
}
