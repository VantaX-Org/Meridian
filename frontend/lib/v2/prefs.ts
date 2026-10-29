"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { V2Persona } from "./hooks";

/**
 * Two choices that belong to this browser, not to the account: the start screen (a persona that overrides the one the
 * role gives) and whether keyboard hints show. The server's preferences document has no key for either, so they live
 * in localStorage; every access is wrapped because storage can be blocked.
 */
const PERSONA_KEY = "mn_v2_persona";
const HINTS_KEY = "mn_v2_hints";
const EVENT = "m2:prefs";

const PERSONAS: readonly V2Persona[] = ["lead", "steward", "basis"];

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice lasts until the page is closed */
  }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

export function readPersonaOverride(): V2Persona | null {
  const v = read(PERSONA_KEY);
  return PERSONAS.includes(v as V2Persona) ? (v as V2Persona) : null;
}
export const setPersonaOverride = (p: V2Persona | null): void => write(PERSONA_KEY, p);

/** The start-screen persona the person chose, or null to follow their role. */
export function usePersonaOverride(): V2Persona | null {
  return useSyncExternalStore(subscribe, readPersonaOverride, () => null);
}

export const readKeyHints = (): boolean => read(HINTS_KEY) !== "off";
export const setKeyHints = (on: boolean): void => write(HINTS_KEY, on ? null : "off");

/** Whether keyboard hints show (on unless switched off). */
export function useKeyHints(): boolean {
  return useSyncExternalStore(subscribe, readKeyHints, () => true);
}

/** Puts the hints choice on the page: CSS hides every key cap when it is off. Mounted once, by the shell. */
export function useApplyKeyHints(): void {
  const on = useKeyHints();
  useEffect(() => {
    if (on) delete document.documentElement.dataset.m2Hints;
    else document.documentElement.dataset.m2Hints = "off";
  }, [on]);
}
