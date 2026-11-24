import { useQueryClient } from "@tanstack/react-query";
import { useToast, type Severity, type ToastTone } from "@/ui/kit";
import { describeField } from "@/lib/v2/sap-fields";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";

const SEVS: readonly string[] = ["critical", "high", "medium", "low", "info"];
export const sevOf = (s: string): Severity => (SEVS.includes(s) ? (s as Severity) : "info");
export const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
/** The plain-words description of a SAP field: the API's own text first, then the field dictionary. */
export const fieldText = (code?: string | null, given?: string | null): string => given ?? (code ? describeField(code) ?? "" : "");
export const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "");
/** A person's name for a picker, with the email beside it when someone else in the list has the same name. */
export const personLabel = (p: { id: string; name: string; email?: string | null }, all: readonly { id: string; name: string }[]): string =>
  p.email && all.some((o) => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase()) ? `${p.name} (${p.email})` : p.name;

/** An outcome sentence with its own tone, for a write that succeeds but reports problems (a write-back with SAP errors). */
export interface Outcome { text: string; tone: ToastTone }

/** The toast after a second person approves a write-back: SAP's errors are shown, never a bare "written" when some failed. */
export function writebackOutcome(x: { applied: number; errors: readonly string[] }): string | Outcome {
  const done = t("{n} records are written.", { n: whole(x.applied) });
  if (!x.errors.length) return done;
  return { text: `${done} ${t("{n} problems reported: {first}", { n: whole(x.errors.length), first: x.errors[0] })}`, tone: "bad" };
}

/** Runs a write, refreshes every v2 read, and tells the person the outcome in a toast. Returns the result, or null on failure. */
export function useDo() {
  const qc = useQueryClient();
  const toast = useToast();
  return async function run<T>(fn: () => Promise<T>, done: (r: T) => string | Outcome): Promise<T | null> {
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: ["v2"] });
      const o = done(r);
      if (typeof o === "string") toast(o, "good"); else toast(o.text, o.tone);
      return r;
    } catch (e) {
      toast(errorSentence(e, t("That did not work. Try again.")), "bad");
      return null;
    }
  };
}
