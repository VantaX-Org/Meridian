import { createElement } from "react";
import type { SheetDef } from "./kit/SheetHost";
import { t } from "@/lib/v2/i18n";
import { LibraryRuleSheet, RuleSheet } from "./screens/rules/RuleSheet";

/** The sheets any screen can open with useSheet().open(id, arg). Add one entry per sheet; keep its body in the screen's own folder. */
export const SHEETS: Record<string, SheetDef> = {
  // batch 6
  rule: { get label() { return t("Rule"); }, render: (arg) => createElement(RuleSheet, { arg: arg as { id: string } }) },
  "library-rule": { get label() { return t("Rule"); }, render: (arg) => createElement(LibraryRuleSheet, { arg: arg as { id: string } }) },
};
