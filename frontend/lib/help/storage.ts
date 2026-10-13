/**
 * Where tour completion and the last-seen release live. localStorage for now;
 * lane 4 moves both to server-side user preferences (`tours_done`,
 * `seen_version`), so everything that reads or writes them goes through here.
 * Every access is wrapped: storage can be blocked or throw in private windows.
 */
export const TOUR_KEY_PREFIX = "m-tour:";
export const SEEN_VERSION_KEY = "m-seen-version";
export const CHECKLIST_DISMISSED_KEY = "m-first-run-checklist";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** For `useSyncExternalStore`: fires on a write here or in another tab. */
export function subscribeStorage(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
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

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  emit();
}

export const isTourDone = (id: string): boolean => read(`${TOUR_KEY_PREFIX}${id}`) === "done";
export const markTourDone = (id: string): void => write(`${TOUR_KEY_PREFIX}${id}`, "done");
export const resetTour = (id: string): void => remove(`${TOUR_KEY_PREFIX}${id}`);

export const readSeenVersion = (): string | null => read(SEEN_VERSION_KEY);
export const writeSeenVersion = (version: string): void => write(SEEN_VERSION_KEY, version);

export const isChecklistDismissed = (): boolean => read(CHECKLIST_DISMISSED_KEY) === "dismissed";
export const dismissChecklist = (): void => write(CHECKLIST_DISMISSED_KEY, "dismissed");
