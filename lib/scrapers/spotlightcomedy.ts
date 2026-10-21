import { EventbriteOrganizerScraper } from "./eventbriteOrganizer";

// https://www.eventbrite.com/o/spotlight-comedy-62788201173/
export class SpotlightComedyScraper extends EventbriteOrganizerScraper {
  readonly sourceSlug: string = "spotlightcomedy";
  protected override readonly organizerId = "62788201173";
}
