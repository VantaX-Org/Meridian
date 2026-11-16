import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";

/** "16 Oct", the date on the axis. */
export function shortDate(iso: string | null | undefined): string {
  return formatDate(iso, "date").replace(/\s+\d{4}$/, "");
}

const KIND_WORD: Record<string, () => string> = { scheduled: () => t("Scheduled"), manual: () => t("Started by hand"), recheck: () => t("Recheck"), upload: () => t("Upload") };

/** What started a run, in words; an unknown kind as sent, no kind a dash. */
export const kindWord = (kind: string | null | undefined): string => (kind ? (Object.hasOwn(KIND_WORD, kind) ? KIND_WORD[kind]() : kind) : "—");

/**
 * What started a run: the timeline's kind, else the run's own trigger, else "upload" for a run made from an uploaded
 * file (runs uploaded before the trigger was stored carry only their source or file name).
 */
export function triggerOf(kind: string | null | undefined, metadata: { trigger?: string; source?: string; upload_id?: string; file_name?: string; filename?: string } | null | undefined): string | null {
  if (kind) return kind;
  if (metadata?.trigger) return metadata.trigger;
  if (metadata?.source === "upload" || metadata?.upload_id || metadata?.file_name || metadata?.filename) return "upload";
  return null;
}
