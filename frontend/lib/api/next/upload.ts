/**
 * Client side of the multi-file upload: check a file before it is sent, read the hidden `_meridian` marker sheet
 * (version_id, module, kind) a downloaded workbook carries, and run uploads a few at a time. The upload itself is
 * lib/api/v2/roundtrip.ts (POST /upload/roundtrip), unchanged.
 */
import { t } from "@/lib/v2/i18n";

export const MAX_BYTES = 25 * 1024 * 1024;

/** The sentence that stops a file before upload, or null when it may go. */
export function checkFile(file: File): string | null {
  if (!/\.(xlsx|csv)$/i.test(file.name)) return t("Upload the Excel (.xlsx) or CSV file you exported.");
  if (file.size > MAX_BYTES) return t("The file is larger than 25 MB.");
  return null;
}

export interface Marker {
  version_id?: string;
  module?: string;
  kind?: string;
}

/** The marker of a workbook Meridian wrote; empty for a CSV, a foreign workbook or one that cannot be read. */
export async function readMarker(file: File): Promise<Marker> {
  if (!/\.xlsx$/i.test(file.name)) return {};
  try {
    const XLSX = await import("xlsx");
    const book = XLSX.read(await file.arrayBuffer(), { type: "array", sheets: "_meridian" });
    const sheet = book.Sheets._meridian;
    if (!sheet) return {};
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const out: Record<string, string> = {};
    for (const [k, v] of rows) if (typeof k === "string" && v != null) out[k] = String(v);
    return { version_id: out.version_id, module: out.module, kind: out.kind };
  } catch {
    return {};
  }
}

/** Runs `work` on every item, at most `size` at once, in order of start. */
export async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}
