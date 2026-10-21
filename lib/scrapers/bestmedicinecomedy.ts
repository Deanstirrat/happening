import { EventbriteOrganizerScraper } from "./eventbriteOrganizer";

// https://www.eventbrite.com/o/best-medicine-comedy-26380464595/
export class BestMedicineComedyScraper extends EventbriteOrganizerScraper {
  readonly sourceSlug: string = "bestmedicinecomedy";
  protected override readonly organizerId = "26380464595";
}
