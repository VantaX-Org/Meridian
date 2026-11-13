import { t } from "@/lib/v2/i18n";
import type { Seg } from "../kit/charts";

/** The three outcomes of a load as bar parts; the figures are the API's, the bar only shows their shares. */
export const loadSegs = (c: { would_load: number; provisional: number; would_fail: number }): Seg[] => [
  { key: "load", label: t("Would load"), value: c.would_load, tone: "good" },
  { key: "warn", label: t("With a warning"), value: c.provisional, tone: "warn" },
  { key: "fail", label: t("Would be rejected"), value: c.would_fail, tone: "bad" },
];
