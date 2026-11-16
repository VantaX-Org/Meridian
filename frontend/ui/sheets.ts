import type { SheetDef } from "./kit/SheetHost";
import { t } from "@/lib/v2/i18n";
import { renderBalance, renderDelegations, renderInvite, renderPerson } from "./screens/people/sheets";
import { createElement } from "react";
import { GoldenSheet } from "./screens/mdm/GoldenSheet";
import { TermSheet } from "./screens/mdm/catalogue/TermSheet";
import { ADMIN_SHEETS } from "./screens/admin/sheets";

/** The sheets any screen can open with useSheet().open(id, arg). Add one entry per sheet; keep its body in the screen's own folder. */
export const SHEETS: Record<string, SheetDef> = {
  // batch 9
  person: { get label() { return t("Person"); }, render: renderPerson },
  invite: { get label() { return t("Invite a person"); }, render: renderInvite },
  balance: { get label() { return t("Balance the work"); }, render: renderBalance },
  delegations: { get label() { return t("Delegations"); }, render: renderDelegations },
  // batch 7a
  golden: { label: t("Golden record"), render: (id) => createElement(GoldenSheet, { id: String(id) }) },
  // batch 7b
  term: { get label() { return t("Glossary term"); }, render: (arg) => createElement(TermSheet, { arg }) },
  // batch 11b
  ...ADMIN_SHEETS,
};
