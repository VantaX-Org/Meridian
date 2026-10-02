/** Client-side peek at an import file: header row and a few sample rows for column matching. */

/** Delimited-text preview: handles double-quote escapes, not multi-line cells. */
export function parseCsvPreview(text: string, maxRows = 6): string[][] {
  const sep = text.includes("\t") && !text.includes(",") ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, maxRows + 1);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === sep && !quoted) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

export async function readHeaderSample(file: File): Promise<{ headers: string[]; sample: string[][] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    const rows = parseCsvPreview(await file.slice(0, 32 * 1024).text(), 6);
    if (!rows.length) return { headers: [], sample: [] };
    const [headers, ...sample] = rows;
    return { headers, sample };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    try {
      // loaded on demand so the workbook parser only enters the bundle when a workbook is picked
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) return { headers: [], sample: [] };
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][];
      if (!rows.length) return { headers: [], sample: [] };
      return {
        headers: (rows[0] ?? []).map((c) => String(c ?? "").trim()),
        sample: rows.slice(1, 7).map((r) => (r ?? []).map((c) => String(c ?? ""))),
      };
    } catch {
      return { headers: [], sample: [] };
    }
  }
  // JSON / Parquet: the backend reads the schema from the file itself
  return { headers: [], sample: [] };
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}
