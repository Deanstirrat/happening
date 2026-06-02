import { EventbriteScraper } from "./eventbrite";

export class BestMedicineComedyScraper extends EventbriteScraper {
  readonly sourceSlug: string = "bestmedicinecomedy";
  protected override readonly BASE_URLS = [
    "https://www.eventbrite.com/o/best-medicine-comedy-26380464595/",
  ];
}
