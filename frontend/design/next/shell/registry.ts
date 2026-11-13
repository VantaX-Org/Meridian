import type { SheetRenderer } from "./SheetHost";

/** Kept apart from SheetHost so sheets.ts can register at import time without a circular-import TDZ error. */
export const registry = new Map<string, SheetRenderer>();
/** Adds a sheet kind. The renderer returns a kit `Sheet` (open is the renderer's to set to true). */
export function registerSheet(kind: string, render: SheetRenderer): void {
  registry.set(kind, render);
}
