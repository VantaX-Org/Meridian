import { setFormatPrefs } from "./format";

/** Row density tiers; mirrors the CSS `[data-density]` values. */
export type DensityTier = "compact" | "default" | "comfortable";
/** "system" clears data-theme so the tokens follow prefers-color-scheme. */
export type Theme = "dark" | "light" | "system";
export type DigestFrequency = "daily" | "weekly" | "off";

/** A saved table view; `name` is the only key the server requires, the rest belong to design/table/views.ts. */
export interface SavedViewRecord {
  name: string;
}

export interface NotificationPrefs {
  digest?: DigestFrequency;
  immediate_critical?: boolean;
  channels?: Record<string, boolean>;
}

/** The user-preferences document; the server validates the same keys (api/routes/preferences.py). */
export interface Preferences {
  theme?: Theme;
  density?: DensityTier;
  locale?: string;
  timezone?: string;
  /** Saved table views by table id. */
  saved_views?: Record<string, SavedViewRecord[]>;
  /** Ids of the tours the user finished or dismissed (wired by the tour component). */
  tours_done?: string[];
  /** The last "What's new" version the user saw (wired by the What's new drawer). */
  seen_version?: string;
  notifications?: NotificationPrefs;
}

/** A JSON merge patch: objects merge key by key, null removes a key, arrays and scalars replace. */
export interface PreferencesPatch {
  theme?: Theme | null;
  density?: DensityTier | null;
  locale?: string | null;
  timezone?: string | null;
  saved_views?: Record<string, SavedViewRecord[] | null> | null;
  tours_done?: string[] | null;
  seen_version?: string | null;
  notifications?: {
    digest?: DigestFrequency | null;
    immediate_critical?: boolean | null;
    channels?: Record<string, boolean | null> | null;
  } | null;
}

/** The whole document, kept in localStorage so the first paint needs no network. */
export const PREFS_KEY = "meridian:prefs";
/** Per-key mirrors that the inline first-paint script in app/layout.tsx reads (and that pre-sync builds wrote). */
const THEME_KEY = "meridian:theme";
const DENSITY_KEY = "meridian:density";
/** Same event name hooks/use-theme.ts has always used. */
export const PREFS_EVENT = "meridian:prefs";

const EMPTY: Preferences = Object.freeze({}) as Preferences;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** RFC 7386 merge: returns a new document, never mutates. Nulls never remain in the result. */
export function mergePrefs<T extends object>(base: T, patch: object): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[key];
    else if (isRecord(value)) out[key] = mergePrefs(isRecord(out[key]) ? out[key] : {}, value);
    else out[key] = value;
  }
  return out as T;
}

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode or full: the preference lives for this session and on the server */
  }
}

const THEMES: readonly string[] = ["dark", "light", "system"];
const DENSITIES: readonly string[] = ["compact", "default", "comfortable"];

let cacheRaw: string | null | undefined;
let cacheValue: Preferences = EMPTY;

/** The current document. Referentially stable until it changes, so it is safe for useSyncExternalStore. */
export function readPrefs(): Preferences {
  if (typeof window === "undefined") return EMPTY;
  const doc = readKey(PREFS_KEY);
  const theme = readKey(THEME_KEY) ?? readKey("aurora:theme");
  const density = readKey(DENSITY_KEY) ?? readKey("aurora:density");
  const raw = `${doc}|${theme}|${density}`;
  if (raw === cacheRaw) return cacheValue;
  let parsed: Preferences = {};
  try {
    const v: unknown = doc ? JSON.parse(doc) : {};
    if (isRecord(v)) parsed = v as Preferences;
  } catch {
    /* corrupt document: start empty */
  }
  // Documents written before sync existed only have the per-key mirrors.
  if (!parsed.theme && theme && THEMES.includes(theme)) parsed = { ...parsed, theme: theme as Theme };
  if (!parsed.density && density && DENSITIES.includes(density)) parsed = { ...parsed, density: density as DensityTier };
  cacheRaw = raw;
  cacheValue = Object.keys(parsed).length === 0 ? EMPTY : parsed;
  return cacheValue;
}

function emit(): void {
  window.dispatchEvent(new Event(PREFS_EVENT));
}

function persist(next: Preferences): void {
  writeKey(PREFS_KEY, Object.keys(next).length === 0 ? null : JSON.stringify(next));
  writeKey(THEME_KEY, next.theme ?? null);
  writeKey(DENSITY_KEY, next.density ?? null);
  setFormatPrefs({ locale: next.locale, timezone: next.timezone });
}

/** Called with every local change so the server copy follows; registered once the user is signed in. */
type Sink = (patch: PreferencesPatch) => void;
let sink: Sink | null = null;
/** Patches made while the server copy is loading (null when not loading); merged over it when it arrives. */
let pending: PreferencesPatch | null = null;
/** True after a clear that kept the appearance mirrors, so they are not mistaken for the next user's own choices. */
let carried = false;

export function registerPreferencesSink(next: Sink | null): void {
  sink = next;
}

/** Composes two patches into one that keeps explicit nulls (unlike mergePrefs, which applies them). */
export function composePatch(a: PreferencesPatch, b: PreferencesPatch): PreferencesPatch {
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [key, value] of Object.entries(b)) {
    if (isRecord(value) && isRecord(out[key])) out[key] = composePatch(out[key] as PreferencesPatch, value as PreferencesPatch);
    else out[key] = value;
  }
  return out as PreferencesPatch;
}

/** Starts queueing local changes until `hydratePreferences` (or `abandonPreferencesLoad`) runs. */
export function beginPreferencesLoad(): void {
  pending = {};
}

/** The server copy could not be loaded: send what was queued as ordinary changes. */
export function abandonPreferencesLoad(): void {
  const queued = pending;
  pending = null;
  if (queued && Object.keys(queued).length > 0) sink?.(queued);
}

/** Applies a patch locally (storage, then subscribers, so the next paint is right) and forwards it to the server. */
export function setPreferences(patch: PreferencesPatch): void {
  if (typeof window === "undefined") return;
  persist(mergePrefs(readPrefs(), patch));
  emit();
  if (pending) pending = composePatch(pending, patch);
  else sink?.(patch);
}

/**
 * Reconciles with the server copy after sign-in. The server wins, so a user's choices follow them to another
 * browser, except that changes made while it was loading are merged over it and returned for the caller to upload.
 * When the server holds nothing yet, this browser's own choices are adopted and returned as a patch for the caller
 * to upload (the one-time migration of pre-sync localStorage values), unless they were carried over from a
 * previous user.
 */
export function hydratePreferences(server: Preferences): PreferencesPatch | null {
  if (typeof window === "undefined") return null;
  const queued = pending && Object.keys(pending).length > 0 ? pending : null;
  const wasCarried = carried;
  pending = null;
  carried = false;
  if (Object.keys(server).length === 0) {
    const base: Preferences = wasCarried ? mergePrefs({}, queued ?? {}) : readPrefs();
    persist(base);
    emit();
    return Object.keys(base).length > 0 ? (base as PreferencesPatch) : null;
  }
  persist(queued ? mergePrefs(server, queued) : server);
  emit();
  return queued;
}

const USER_KEY = "meridian:prefs-user";

/**
 * Empties this browser's preferences cache: the document, pre-sync keys, saved views and tour marks. The theme and
 * density mirrors stay so the page does not flash while the next user's own copy loads; hydration replaces them.
 */
export function clearLocalPreferences(): void {
  if (typeof window === "undefined") return;
  try {
    const stale: string[] = ["aurora:theme", "aurora:density", PREFS_KEY];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && (k.startsWith("m-table-views:") || k.startsWith("m-tour:"))) stale.push(k);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage blocked: nothing cached */
  }
  carried = true;
  setFormatPrefs({});
  resetPreferencesCache();
  emit();
}

/** Call with the signed-in user's id: a different id from the last one on this browser clears the cache. */
export function syncPreferencesUser(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const last = window.localStorage.getItem(USER_KEY);
    if (last && last !== userId) clearLocalPreferences();
    window.localStorage.setItem(USER_KEY, userId);
  } catch {
    /* storage blocked */
  }
}

export function subscribePreferences(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(PREFS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PREFS_EVENT, cb);
  };
}

/** Test seam: forget the memoised document. */
export function resetPreferencesCache(): void {
  cacheRaw = undefined;
  cacheValue = EMPTY;
}

/** Locales offered on the preferences page: the browser's own plus a short list of common ones. */
export function localeOptions(): string[] {
  const common = ["en-GB", "en-US", "en-ZA", "en-AU", "de-DE", "fr-FR", "es-ES", "nl-NL", "pt-BR", "it-IT"];
  const own = typeof navigator !== "undefined" ? navigator.languages ?? [] : [];
  return [...new Set([...own, ...common])].filter((l) => {
    try {
      return Intl.DateTimeFormat.supportedLocalesOf(l).length > 0;
    } catch {
      return false;
    }
  });
}

/** IANA zones from Intl, with UTC first. */
export function timezoneOptions(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = fn ? fn("timeZone") : [];
  return ["UTC", ...zones.filter((z) => z !== "UTC")];
}
