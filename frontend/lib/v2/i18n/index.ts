import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";
import { getFormatLocale, setFormatPrefs } from "@/lib/format";
import { readPrefs, subscribePreferences } from "@/lib/preferences";
import { de } from "./de";
import { en, type MessageKey } from "./en";
import { formatMessage, type MessageVars } from "./icu";
import { ja } from "./ja";

/**
 * The v2 interface in three languages. Messages are keyed by their English text (the catalogue in en.ts is the list
 * of every string the interface may show); de.ts and ja.ts must translate every key, which the type of each
 * catalogue enforces. The language follows the person's locale preference (Preferences, Language): "de-CH" reads
 * German with Swiss numbers, "ja-JP" Japanese, anything else English. Check ids, TABLE.FIELD names, record keys and
 * run ids are never keys: they stay as SAP wrote them.
 */
export type Lang = "en" | "de" | "ja";
export type { MessageKey, MessageVars };

export const CATALOGUES: Record<Lang, Readonly<Record<MessageKey, string>>> = { en, de, ja };

/** The languages the picker offers, each named in itself, with the region it starts in. */
export const LANGUAGES: readonly { lang: Lang; name: string; tag: string }[] = [
  { lang: "en", name: "English", tag: "en-GB" },
  { lang: "de", name: "Deutsch", tag: "de-DE" },
  { lang: "ja", name: "日本語", tag: "ja-JP" },
];

/** The language a BCP 47 tag reads in: its primary subtag when we have it, else English. */
export function langOf(tag: string | null | undefined): Lang {
  const primary = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  return primary === "de" || primary === "ja" ? primary : "en";
}

let active: Lang = "en";
let activeTag = "en-US";

/** The language t() writes in now. */
export const currentLang = (): Lang => active;
/** The tag plurals and digits follow: the preference when it is in the active language, else the language's own. */
export const currentTag = (): string => activeTag;

/** A word lowered to run on inside a sentence: English lowers it; German nouns keep their capital, Japanese has no case. */
export const lc = (s: string): string => (active === "en" ? s.toLowerCase() : s);
/** Only the first letter lowered, on the same terms. */
export const lcFirst = (s: string): string => (active === "en" ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Sets the language t() writes in (the shell does it from the preference; tests call it directly). */
export function setLang(lang: Lang, tag?: string): void {
  active = lang;
  activeTag = tag && langOf(tag) === lang ? tag : lang === "de" ? "de-DE" : lang === "ja" ? "ja-JP" : "en-US";
}

function lookup(key: string): string {
  const own = (CATALOGUES[active] as Record<string, string | undefined>)[key];
  if (own !== undefined && own !== "") return own;
  const english = (en as Record<string, string | undefined>)[key];
  return english ?? key;
}

/** One message of the catalogue, in the active language, with its placeholders filled. */
export function t(key: MessageKey, vars?: MessageVars): string {
  return formatMessage(lookup(key), vars, activeTag);
}

/**
 * A message whose key is only known at run time (an object label from the API, a section name from a table). A key
 * the catalogue does not have comes back as given, so a new label from the server still reads in English.
 */
export function tx(key: string, vars?: MessageVars): string {
  return formatMessage(lookup(key), vars, activeTag);
}

/**
 * A message with elements inside it (a link to a rule, a mark): the sentence is the translator's, the elements sit
 * where its placeholders say. Plain values are formatted as t() does; element values come back in place, keyed.
 */
export function tn(key: MessageKey, vars: Record<string, ReactNode>): ReactNode[] {
  const plain: MessageVars = {};
  const nodes: ReactNode[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (v === null || v === undefined || typeof v === "string" || typeof v === "number") plain[k] = v;
    else if (typeof v === "boolean") plain[k] = String(v);
    else {
      plain[k] = `\u0000${nodes.length}\u0000`;
      nodes.push(v);
    }
  }
  const text = formatMessage(lookup(key), plain, activeTag);
  return text
    .split(/\u0000(\d+)\u0000/)
    .map((part, i) => (i % 2 === 1 ? createElement(Fragment, { key: i }, nodes[Number(part)]) : part))
    .filter((p) => p !== "");
}

/** True when the catalogue has this text: the extraction test and the fallbacks ask. */
export const hasMessage = (key: string): boolean => Object.prototype.hasOwnProperty.call(en, key);

/** The tag the preference names, read the same way on every render (the format module's copy when it has one). */
function preferredTag(): string {
  return readPrefs().locale ?? getFormatLocale() ?? "";
}

/**
 * The language of the v2 interface, for the component at its root. It reads the preference (the server render and
 * the first client render read English, so hydration matches), makes t() write in it, and keeps the number and date
 * formatter on the same locale after a reload. Returns the BCP 47 tag for the `lang` attribute.
 */
export function useInterfaceLang(): { lang: Lang; tag: string } {
  const tag = useSyncExternalStore(subscribePreferences, preferredTag, () => "");
  const lang = langOf(tag);
  setLang(lang, tag || undefined);
  const prefs = readPrefs();
  if (prefs.locale && prefs.locale !== getFormatLocale()) setFormatPrefs({ locale: prefs.locale, timezone: prefs.timezone });
  return { lang, tag: activeTag };
}
