import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

const SHORT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 1234567 reads "1.2M"; below 10 000 it stays whole. */
export const compactCount = (n: number): string => (Math.abs(n) < 10_000 ? int(n) : SHORT.format(n));

export const sevLabel = (s: string | null | undefined): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));

/** A 0 to 1 or 0 to 100 rate as a whole percent; the unit is guessed from the size. */
export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : `${Math.round(n <= 1 ? n * 100 : n)}%`);

/** Library rule ids read "rule-MM142"; the rest of the app uses the bare check id. */
export const checkId = (id: string): string => id.replace(/^rule-/, "");

/** Check ids and module codes are shown with their text; this is the one place a sheet arg is shaped. */
export interface RuleArg { id: string }

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
