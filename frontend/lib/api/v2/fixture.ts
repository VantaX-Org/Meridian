"use client";

import { useSyncExternalStore } from "react";

/**
 * Fixture mode: `/?fixture=1` answers every v2 read from lib/api/v2/fixtures instead of the API, so the interface
 * can be built, screenshotted and tested with no backend. The flag is kept for the tab (sessionStorage) so links that
 * do not carry the query keep working; `?fixture=0` turns it off. Only builds that allow it (fixtureAllowed) honour the
 * query, and while it is on every page carries the "Demo data" bar (design/v2/shell/DemoBar.tsx).
 */
const KEY = "mn_v2_fixture";

/**
 * Whether this build may answer from fixtures at all. A production build may only when it was built for a demo or a
 * test run (NEXT_PUBLIC_MERIDIAN_DEMO=1 at build time: the e2e web server and the help recordings set it); a customer
 * image never does, so `?fixture=1` on a customer's deployment is ignored. Development and tests always may. Both
 * variables are read as literal properties so Next inlines them at build time.
 */
export function fixtureAllowed(): boolean {
  return process.env.NEXT_PUBLIC_MERIDIAN_DEMO === "1" || process.env.NODE_ENV !== "production";
}

function readStore(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** True when this page is in fixture mode. Safe on the server (false) and when storage is blocked. */
export function fixtureActive(): boolean {
  if (typeof window === "undefined" || !fixtureAllowed()) return false;
  let q: string | null = null;
  try {
    q = new URLSearchParams(window.location.search).get("fixture");
  } catch {
    q = null;
  }
  if (q === "1") {
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked: the query alone keeps the mode for this load */
    }
    return true;
  }
  if (q === "0") {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* nothing stored to clear */
    }
    return false;
  }
  return readStore();
}

/** A query-string value of the current page (rows, persona), or null. Used only by fixture mode. */
export function fixtureParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

const noop = () => () => undefined;

/** Hydration-safe flag for components: false on the server and the first client render, then the real value. */
export function useFixture(): boolean {
  return useSyncExternalStore(noop, fixtureActive, () => false);
}

/** The address keys fixture mode carries from page to page: who is looking (`role`, `persona`). */
export const FIXTURE_CARRY = ["role", "persona"] as const;

/** The carried keys of the current page (`?role=sap_basis`), so a demo follows a journey across screens as one person. */
export function fixtureCarry(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FIXTURE_CARRY) {
    const v = fixtureParam(k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * A v2 href that keeps fixture mode: appends `fixture=1` when the page is in it, and the carried keys (`role`,
 * `persona`) the href does not set itself, so a link never drops the person the demo is walking as.
 */
export function withFixture(href: string, on: boolean, carry: Readonly<Record<string, string>> = {}): string {
  if (!on) return href;
  const hash = href.indexOf("#");
  let base = hash >= 0 ? href.slice(0, hash) : href;
  const tail = hash >= 0 ? href.slice(hash) : "";
  const has = (k: string) => new RegExp(`[?&]${k}=`).test(base);
  const add = (k: string, v: string) => {
    base = `${base}${base.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
  };
  if (!has("fixture")) add("fixture", "1");
  for (const [k, v] of Object.entries(carry)) if (!has(k)) add(k, v);
  return `${base}${tail}`;
}
