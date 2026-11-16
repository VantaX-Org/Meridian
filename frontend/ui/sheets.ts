import { createElement } from "react";
import type { SheetDef } from "./kit/SheetHost";
import { GoldenSheet } from "./screens/mdm/GoldenSheet";
import { t } from "@/lib/v2/i18n";

export const SHEETS: Record<string, SheetDef> = {
  // batch 7a
  golden: { label: t("Golden record"), render: (id) => createElement(GoldenSheet, { id: String(id) }) },
};
