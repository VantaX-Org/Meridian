import { readPrefs, setPreferences, subscribePreferences } from "@/lib/preferences";

/**
 * Where tour completion and the last-seen release live. Both are user
 * preferences (`tours_done`, `seen_version`), so they follow the account to
 * any browser; only the checklist-dismissed flag stays in localStorage.
 * Every localStorage access is wrapped: storage can be blocked or throw in
 * private windows.
 */
export const TOUR_KEY_PREFIX = "m-tour:";
export const SEEN_VERSION_KEY = "m-seen-version";
export const CHECKLIST_DISMISSED_KEY = "m-first-run-checklist";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** For `useSyncExternalStore`: fires on a preference change or a checklist write, here or in another tab. */
export function subscribeStorage(onChange: () => void): () => void {
  listeners.add(onChange);
  const off = typeof window !== "undefined" ? subscribePreferences(onChange) : () => {};
  return () => {
    listeners.delete(onChange);
    off();
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the tour or dot simply shows again next visit */
  }
  emit();
}

const toursDone = (): string[] => readPrefs().tours_done ?? [];

export const isTourDone = (id: string): boolean => toursDone().includes(id);
export const markTourDone = (id: string): void => {
  const done = toursDone();
  if (!done.includes(id)) setPreferences({ tours_done: [...done, id] });
};
export const resetTour = (id: string): void => {
  const rest = toursDone().filter((t) => t !== id);
  setPreferences({ tours_done: rest.length > 0 ? rest : null });
};

export const readSeenVersion = (): string | null => readPrefs().seen_version ?? null;
export const writeSeenVersion = (version: string): void => setPreferences({ seen_version: version });

/**
 * The first-run tour offer, closed on this device ("Not now" or "Take the tour"). The account-wide record is the
 * `tours_done` preference; this local copy keeps the offer closed when that save did not reach the server.
 */
export const TOUR_OFFER_CLOSED_PREFIX = "m-tour-offer-closed:";
export const isTourOfferClosed = (id: string): boolean => read(`${TOUR_OFFER_CLOSED_PREFIX}${id}`) === "1";
export const closeTourOffer = (id: string): void => {
  write(`${TOUR_OFFER_CLOSED_PREFIX}${id}`, "1");
  markTourDone(id);
};

/** The tour offer was already shown in this browser session: it is offered once per session at most. */
export const TOUR_OFFERED_PREFIX = "m-tour-offered:";
export function wasTourOfferedThisSession(id: string): boolean {
  try {
    return window.sessionStorage.getItem(`${TOUR_OFFERED_PREFIX}${id}`) === "1";
  } catch {
    return false;
  }
}
export function markTourOfferedThisSession(id: string): void {
  try {
    window.sessionStorage.setItem(`${TOUR_OFFERED_PREFIX}${id}`, "1");
  } catch {
    /* storage unavailable: the offer may show again on the next page load */
  }
}

export const isChecklistDismissed =(): boolean => read(CHECKLIST_DISMISSED_KEY) === "dismissed";
export const dismissChecklist = (): void => write(CHECKLIST_DISMISSED_KEY, "dismissed");
