"use client";

import { useSearchParams } from "next/navigation";

/** True when the address asks for the layout grid (`?grid=1`). */
export function useGridOverlay(): boolean {
  return useSearchParams().get("grid") === "1";
}

/**
 * The layout grid over the page (`?grid=1`): the 8px baseline grid, the canvas gutters and the column bounds of the
 * map, the canvas and the inspector (tokens.css, last section). Off by default and kept in the build so anyone can
 * check an alignment on a customer's own deployment. It takes no click and hides from assistive technology.
 */
export function GridOverlay({ on }: { on: boolean }) {
  return on ? <div className="m2-grid-overlay" aria-hidden="true" data-testid="grid-overlay" /> : null;
}
