import type { SheetDef } from "./kit/SheetHost";
import { RUN_SHEETS } from "./screens/runs/sheets";

/** The sheets any screen can open with useSheet().open(id, arg). Add one entry per sheet; keep its body in the screen's own folder. */
export const SHEETS: Record<string, SheetDef> = {
  // batch 3
  ...RUN_SHEETS,
};
