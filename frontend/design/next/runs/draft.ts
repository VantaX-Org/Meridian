/** A sheet's unsent edits live in sessionStorage under the sheet id, so a refresh or Back keeps them. Never throws. */
const key = (id: string) => `mn_sheet_draft:${id}`;

export function loadDraft<T extends object>(id: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key(id));
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveDraft(id: string, value: object): void {
  try {
    window.sessionStorage.setItem(key(id), JSON.stringify(value));
  } catch {
    /* storage can be off in a private window: the sheet still works, it just forgets on refresh */
  }
}

export function clearDraft(id: string): void {
  try {
    window.sessionStorage.removeItem(key(id));
  } catch {
    /* nothing to clear */
  }
}

/** True for an HTTP 403 from the API: the role lacks the permission, which is not a failure to retry. */
export const isForbidden = (err: unknown): boolean => (err as { response?: { status?: number } } | null)?.response?.status === 403;
