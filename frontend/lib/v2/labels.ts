import { formatModuleName, formatMoneyCompact, labelOf, systemTypeLabel } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { INVITE_TTL_DAYS, STATUS_LABEL, type SeatCount } from "@/lib/users";
import type { UserStatus } from "@/types/api";
import { currentLang, currentTag, t, tx } from "./i18n";
import { whole } from "./format";

/*
 * The shared helpers (lib/format, lib/roles, lib/users) write English for the current interface. The v2 interface
 * reads their words through the catalogue: a word the catalogue has comes back translated, an unknown one (a new
 * status from the server) stays as the helper wrote it.
 */

/** A machine value as words: "pending_approval" reads "Pending approval", "Ausstehende Freigabe", "承認待ち". */
export const labelText = (value: string | null | undefined): string => tx(labelOf(value));
/** A module's name: "material_master" reads "Material master", "Materialstamm", "品目マスタ". */
export const moduleText = (id: string): string => tx(formatModuleName(id));
/** A role's name. */
export const roleText = (key: string): string => tx(roleLabel(key));
/** A system type's name. */
export const systemTypeText = (type: string | null | undefined): string => tx(systemTypeLabel(type));
/** A user's status word. */
export const userStatusText = (s: UserStatus): string => tx(STATUS_LABEL[s]);

/** "41 of 50 seats", or "41 seats in use" when the licence has no limit. */
export function seatsText(s: SeatCount): string {
  return s.limit == null ? t("{used, plural, one {# seat} other {# seats}} in use", { used: s.used }) : t("{used} of {limit} seats", { used: whole(s.used), limit: whole(s.limit) });
}

/** "2 invites older than 7 days, 1 delivery failed", or null when nothing needs attention. */
export function inviteAttentionText(a: { stale: number; failed: number }): string | null {
  const parts: string[] = [];
  if (a.stale) parts.push(t("{stale, plural, one {# invite} other {# invites}} older than {days} days", { stale: a.stale, days: INVITE_TTL_DAYS }));
  if (a.failed) parts.push(t("{failed, plural, one {# delivery} other {# deliveries}} failed", { failed: a.failed }));
  return parts.length ? parts.join(", ") : null;
}

/** Headline money: the current interface's "ZAR 4.84 bn" in English, the locale's own compact form otherwise. */
export function moneyCompactText(n: number | null | undefined, currency?: string | null): string {
  if (currentLang() === "en" || typeof n !== "number" || !Number.isFinite(n)) return formatMoneyCompact(n, currency);
  try {
    const value = new Intl.NumberFormat(currentTag(), { notation: "compact", maximumSignificantDigits: 3 }).format(n);
    return currency ? `${currency} ${value}` : value;
  } catch {
    return formatMoneyCompact(n, currency);
  }
}

/** A migration gap type in words; field_status_* names the target field status. Unknown types show as sent. */
const GAP_TEXT: Record<string, () => string> = {
  unmapped_field: () => t("Field with no mapping"),
  obsolete_target: () => t("Target field no longer exists"),
  target_field_missing: () => t("Target field missing"),
  value_unmapped: () => t("Value with no target value"),
  target_mandatory: () => t("Mandatory target field empty"),
  key_missing: () => t("Key missing"),
  key_collision: () => t("Two records get the same key"),
  target_key_exists: () => t("Key already in the target"),
  length_truncation: () => t("Value longer than the target field"),
  type_conversion: () => t("Type does not convert"),
  precision_loss: () => t("Decimals lost"),
  case_change: () => t("Case changes"),
  domain_value: () => t("Value outside the field's domain"),
  check_table_value: () => t("Value not in the check table"),
  target_config_unverified: () => t("Target configuration not verified"),
};
export const gapText = (g: string) => GAP_TEXT[g]?.() ?? (g.startsWith("field_status_") ? t("Field status in the target: {kind}", { kind: g.slice(13) }) : g);
