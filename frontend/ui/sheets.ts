import type { SheetDef } from "./kit/SheetHost";
// batch 4
import { workSheets } from "./screens/work/sheets";

/** The sheets any screen can open with useSheet().open(id, arg). Add one entry per sheet; keep its body in the screen's own folder. */
export const SHEETS: Record<string, SheetDef> = {
  // batch 4
  ...workSheets,
};
