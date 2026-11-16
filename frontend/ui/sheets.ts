import { createElement } from "react";
import type { SheetDef } from "./kit/SheetHost";
import { t } from "@/lib/v2/i18n";
import { TermSheet } from "./screens/mdm/catalogue/TermSheet";

/** The sheets any screen can open with useSheet().open(id, arg). Add one entry per sheet; keep its body in the screen's own folder. */
export const SHEETS: Record<string, SheetDef> = {
  // batch 7b
  term: { get label() { return t("Glossary term"); }, render: (arg) => createElement(TermSheet, { arg }) },
};
