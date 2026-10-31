"use client";

import { createContext, useContext } from "react";
import type { DensityTier } from "@/lib/preferences";
import type { V2Persona } from "./hooks";

/**
 * Density: how much of a ledger fits on a screen. Two modes, chosen in Preferences and saved with the other
 * preferences (theme, language) on the server and in this browser:
 *
 * - compact: 28 pixel grid rows, 13 pixel text, 8 pixel cell sides. For the people who work through lists all day.
 * - comfortable: 36 pixel grid rows, 14 pixel text, 12 pixel cell sides. For the people who read and decide.
 *
 * Until a person chooses, the role decides: compact for a data steward and SAP Basis, comfortable for everyone else
 * (the programme lead and the data owner first). The stored value "default" (from before the two modes) follows the role.
 * The values the CSS draws are tokens in design/v2/tokens.css under .m2-root[data-density]; the row heights the virtual
 * grid measures with are the two numbers below, and tokens.test.ts holds the two to each other.
 */
export type Density = "compact" | "comfortable";

/** Grid row height per mode, in pixels: --m2-row-h under each data-density. */
export const ROW_H: Record<Density, number> = { compact: 28, comfortable: 36 };

const COMPACT_PERSONAS: ReadonlySet<V2Persona> = new Set<V2Persona>(["steward", "basis"]);

/** The density a persona starts with. */
export const personaDensity = (persona: V2Persona): Density => (COMPACT_PERSONAS.has(persona) ? "compact" : "comfortable");

/** The density in force: the person's choice, else their role's. */
export function resolveDensity(chosen: DensityTier | null | undefined, persona: V2Persona): Density {
  return chosen === "compact" || chosen === "comfortable" ? chosen : personaDensity(persona);
}

/** The density of the shell (V2Shell provides it); comfortable outside one. */
export const DensityContext = createContext<Density>("comfortable");

export const useDensity = (): Density => useContext(DensityContext);
