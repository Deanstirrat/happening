// Anonymous "saved" events live entirely in localStorage — the same store that
// backs the heart/"I'm interested" toggle. An event is "saved" iff its id is in
// this set, so hearting an event from anywhere automatically adds it to the
// saved view (see app/saved). No account or backend write required.

export const SAVED_EVENTS_KEY = "happeningInterestedEvents";

// Fired on the window when the set changes within this tab. The native
// `storage` event only fires in *other* tabs, so we need our own signal to keep
// same-tab UI (the nav badge, the saved page) live as the user toggles hearts.
const CHANGE_EVENT = "happening:saved-events-changed";

export function getSavedEventIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getSavedEventSet(): Set<string> {
  return new Set(getSavedEventIds());
}

export function isEventSaved(id: string): boolean {
  return getSavedEventSet().has(id);
}

export function setEventSaved(id: string, saved: boolean): void {
  if (typeof window === "undefined") return;
  const set = getSavedEventSet();
  if (saved) set.add(id);
  else set.delete(id);
  try {
    localStorage.setItem(SAVED_EVENTS_KEY, JSON.stringify([...set]));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // ignore quota/availability errors
  }
}

/**
 * Subscribe to saved-set changes — both same-tab (custom event) and cross-tab
 * (native `storage`). Returns an unsubscribe function.
 */
export function subscribeSavedEvents(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    // key === null on storage.clear(); otherwise only react to our key.
    if (e.key === null || e.key === SAVED_EVENTS_KEY) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}
