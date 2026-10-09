/**
 * A finding's `record_key` is either a bare identifier ("000000000000000101")
 * or a composite of grain fields ("MATNR=000000000000000101|WERKS=3000").
 * `primary` is the first field's value (MATNR when present), which the
 * material endpoints take as their path key; the rest ride along as filters.
 */
export function parseRecordKey(key: string): { fields: Record<string, string>; primary: string } {
  if (!key.includes("=")) return { fields: {}, primary: key };
  const fields: Record<string, string> = {};
  for (const part of key.split("|")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const primary = fields.MATNR ?? Object.values(fields)[0] ?? key;
  return { fields, primary };
}
