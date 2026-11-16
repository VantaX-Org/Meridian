/** The HTTP status of a failed read, from an axios error or a fixture error. */
export const httpStatus = (e: unknown): number | undefined =>
  (e as { response?: { status?: number } } | null)?.response?.status ?? (e as { status?: number } | null)?.status;

/** Retry a failed read twice, never on 403 or 404: neither changes on a retry. */
export const noRetry4xx = (n: number, e: unknown): boolean => {
  const s = httpStatus(e);
  return s !== 403 && s !== 404 && n < 2;
};

import { t } from "@/lib/v2/i18n";
import type { ChipTone } from "../../kit";

/** A severity as a chip tone and its word; the word always shows, never the colour alone. */
export const sevTone = (s: string | null | undefined): ChipTone => (s === "critical" || s === "high" ? "bad" : s === "medium" ? "warn" : "neutral");
export const sevWord = (s: string | null | undefined): string =>
  s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : s === "info" ? t("Info") : s ?? "-";

import { useRouter } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";

/** Navigate inside the app from a kit Button: the kit has no link button, so a click pushes the route. */
export function useGo(): (to: string) => () => void {
  const router = useRouter();
  const href = useV2Href();
  return (to) => () => router.push(href(to));
}
