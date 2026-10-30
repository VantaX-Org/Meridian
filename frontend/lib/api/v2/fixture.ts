"use client";

import { useSyncExternalStore } from "react";

/**
 * Fixture mode: `/?fixture=1` answers every v2 read from lib/api/v2/fixtures instead of the API, so the interface
 * can be built, screenshotted and tested with no backend. The flag is kept for the tab (sessionStorage) so links that
 * do not carry the query keep working; `?fixture=0` turns it off.
 */
const KEY = "mn_v2_fixture";

function readStore(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** True when this page is in fixture mode. Safe on the server (false) and when storage is blocked. */
export function fixtureActive(): boolean {
  if (typeof window === "undefined") return false;
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

/** A v2 href that keeps fixture mode: appends `fixture=1` when the page is in it. */
export function withFixture(href: string, on: boolean): string {
  if (!on || /[?&]fixture=/.test(href)) return href;
  const hash = href.indexOf("#");
  const base = hash >= 0 ? href.slice(0, hash) : href;
  const tail = hash >= 0 ? href.slice(hash) : "";
  return `${base}${base.includes("?") ? "&" : "?"}fixture=1${tail}`;
}
