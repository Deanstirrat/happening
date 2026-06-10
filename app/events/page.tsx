import { redirect } from "next/navigation";

// The events listing now lives at the root (`/`) so the homepage is a real,
// indexable surface instead of a redirect. `/events` is kept as a permanent
// redirect to `/` so old bookmarks, shared links, and inbound SEO links (with
// their filter query strings) keep working.
export default async function EventsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else if (value !== undefined) {
      qs.set(key, value);
    }
  }
  const query = qs.toString();
  redirect(query ? `/?${query}` : "/");
}
