import type { SheetRenderer } from "./SheetHost";

/** Kept apart from SheetHost so register files can import it without a circular import. */
export const registry = new Map<string, SheetRenderer>();
/** Adds a sheet kind. The renderer returns a kit `Sheet` (open is the renderer's to set to true). */
export function registerSheet(kind: string, render: SheetRenderer): void {
  registry.set(kind, render);
}
