"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { getTheme, type PublicTheme } from "@/lib/api/v2/enterprise";
import { fixtureActive } from "@/lib/api/v2/fixture";
import { t as tr } from "@/lib/v2/i18n";

/**
 * Tenant theming: the accent, the logo and the product name a tenant sets in Admin, Settings, Appearance. The accent
 * replaces the data hue (--m2-data: selected cell, current run, the next-step button, links) and must read at 4.5:1 or
 * better on the light ground; on the dark ground Meridian uses the lightest-needed tint of it that reads at 4.5:1, so
 * one accent works in both themes. The grounds' luminances are those of --m2-sheet in design/v2/tokens.css (white, and
 * the dark sheet); tokens.test.ts holds them to the file, so no colour literal lives here.
 */

/** Relative luminance of --m2-sheet in light (white). */
export const LIGHT_GROUND_LUMINANCE = 1;
/** Relative luminance of --m2-sheet in dark. */
export const DARK_GROUND_LUMINANCE = 0.009869;
/** WCAG 2.1 AA for text and for the accent as a link colour. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#([0-9a-f]{6})$/i;

export const isHex = (v: string): boolean => HEX.test(v.trim());

function channels(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of "#rrggbb". */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio of two luminances, 1 to 21. */
export const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

/** The colour `amount` (0 to 1) of the way from `hex` to white. */
export function towardWhite(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  return `#${hex2(r + (255 - r) * amount)}${hex2(g + (255 - g) * amount)}${hex2(b + (255 - b) * amount)}`;
}

/** The first tint of the accent, in steps of 2%, that reads at 4.5:1 on the dark ground. */
export function darkTint(hex: string): string {
  for (let i = 0; i <= 50; i++) {
    const c = towardWhite(hex, i / 50);
    if (ratio(luminance(c), DARK_GROUND_LUMINANCE) >= MIN_CONTRAST) return c;
  }
  return towardWhite(hex, 1);
}

export interface AccentCheck {
  /** The accent against the light ground; the accent is refused below 4.5. */
  light: number;
  /** The accent as chosen against the dark ground. */
  darkAsChosen: number;
  /** The tint used in the dark theme, and its ratio there. */
  darkTint: string;
  dark: number;
  ok: boolean;
}

/** The contrast result the Appearance form shows, and whether the accent may be saved. */
export function checkAccent(hex: string): AccentCheck | null {
  if (!isHex(hex)) return null;
  const l = luminance(hex);
  const light = ratio(l, LIGHT_GROUND_LUMINANCE);
  const tint = darkTint(hex);
  const dark = ratio(luminance(tint), DARK_GROUND_LUMINANCE);
  return { light, darkAsChosen: ratio(l, DARK_GROUND_LUMINANCE), darkTint: tint.toUpperCase(), dark, ok: light >= MIN_CONTRAST && dark >= MIN_CONTRAST };
}

/**
 * The dark-theme accent the screen uses: the server's `accent_dark` (checked against its own dark ground) when it also
 * reads at 4.5:1 on this interface's dark sheet, else the first tint of it that does.
 */
export function darkAccentFor(accentDark: string): string {
  if (!isHex(accentDark)) return "";
  return ratio(luminance(accentDark), DARK_GROUND_LUMINANCE) >= MIN_CONTRAST ? accentDark : darkTint(accentDark).toUpperCase();
}

/**
 * The attributes the shell root takes from the public theme: the accent's two custom properties and the switch that
 * reads them. Only a customised theme repaints, and only with an accent that reads at 4.5:1 on the light ground.
 */
export function themeRootProps(theme: PublicTheme | null | undefined): { style?: CSSProperties; "data-tenant-accent"?: string } {
  if (!theme?.customised || !isHex(theme.accent) || ratio(luminance(theme.accent), LIGHT_GROUND_LUMINANCE) < MIN_CONTRAST) return {};
  const dark = darkAccentFor(theme.accent_dark) || darkTint(theme.accent).toUpperCase();
  return {
    "data-tenant-accent": "",
    style: { "--m2-tenant-accent": theme.accent, "--m2-tenant-accent-dark": dark } as CSSProperties,
  };
}

/*
 * GET /theme is read once per page load and kept here, outside any query client, because the sign-in page renders
 * before the app's providers matter. The Appearance form puts what it saved straight in, so the shell follows at once.
 */
let themeValue: PublicTheme | null = null;
let themeLoaded: string | null = null;
let themeLoading: Promise<void> | null = null;
const themeListeners = new Set<() => void>();
const notifyTheme = (): void => themeListeners.forEach((l) => l());
const subscribeTheme = (cb: () => void): (() => void) => {
  themeListeners.add(cb);
  return () => {
    themeListeners.delete(cb);
  };
};

/** Sets the theme every screen reads (after a save), or forgets it so the next screen reads it again. */
export function refreshTenantTheme(next?: PublicTheme | null): void {
  if (next === undefined) {
    themeLoaded = null;
    themeLoading = null;
    // A screen is showing the theme: read it again now, so a save shows at once.
    if (themeListeners.size > 0 && typeof window !== "undefined") loadTheme();
  } else {
    themeValue = next;
    themeLoaded = fixtureActive() ? "fixture" : "live";
  }
  notifyTheme();
}

function loadTheme(): void {
  const mode = fixtureActive() ? "fixture" : "live";
  if (themeLoaded === mode || themeLoading) return;
  themeLoading = getTheme()
    .then(
      (t) => {
        themeValue = t;
      },
      () => {
        themeValue = null;
      },
    )
    .finally(() => {
      themeLoaded = mode;
      themeLoading = null;
      notifyTheme();
    });
}

/** The tenant's theme, or null until it has been read (and when it could not be): Meridian's own look meanwhile. */
export function useTenantTheme(): PublicTheme | null {
  const value = useSyncExternalStore(subscribeTheme, () => themeValue, () => null);
  useEffect(() => {
    loadTheme();
  }, []);
  return value;
}

/** The name the tenant gave the product, else Meridian. */
export const productName = (theme: Pick<PublicTheme, "product_name"> | null | undefined): string => theme?.product_name?.trim() || tr("Meridian");

/**
 * For pages outside the v2 root (the sign-in page): the accent goes on the document as the current interface's
 * accent token for as long as the page is open. Only an accent that passes the contrast check is applied.
 */
export function useDocumentAccent(theme: PublicTheme | null): void {
  useEffect(() => {
    const props = themeRootProps(theme);
    if (!theme || !props.style) return;
    const root = document.documentElement;
    const before = root.style.getPropertyValue("--m-accent");
    const dark = root.dataset.theme === "dark" || (root.dataset.theme !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    root.style.setProperty("--m-accent", dark ? String((props.style as Record<string, string>)["--m2-tenant-accent-dark"]) : theme.accent);
    return () => {
      if (before) root.style.setProperty("--m-accent", before);
      else root.style.removeProperty("--m-accent");
    };
  }, [theme]);
}
