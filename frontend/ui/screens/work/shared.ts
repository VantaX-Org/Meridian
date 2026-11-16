import { useQueryClient } from "@tanstack/react-query";
import { useToast, type Severity } from "@/ui/kit";
import { describeField } from "@/lib/v2/sap-fields";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";

const SEVS: readonly string[] = ["critical", "high", "medium", "low", "info"];
export const sevOf = (s: string): Severity => (SEVS.includes(s) ? (s as Severity) : "info");
export const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
/** The plain-words description of a SAP field: the API's own text first, then the field dictionary. */
export const fieldText = (code?: string | null, given?: string | null): string => given ?? (code ? describeField(code) ?? "" : "");
export const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "");

/** Runs a write, refreshes every v2 read, and tells the person the outcome in a toast. Returns the result, or null on failure. */
export function useDo() {
  const qc = useQueryClient();
  const toast = useToast();
  return async function run<T>(fn: () => Promise<T>, done: (r: T) => string): Promise<T | null> {
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: ["v2"] });
      toast(done(r), "good");
      return r;
    } catch (e) {
      toast(errorSentence(e, t("That did not work. Try again.")), "bad");
      return null;
    }
  };
}
