/**
 * Sheets live in the address: `?sheet=<kind>:<id>&step=<n>`. A second sheet is a second `sheet` parameter; `step` belongs
 * to the top one (the one in front). At most two are stacked, and a third replaces the second. Back closes the top sheet
 * and a refresh reopens it, because the address is the only state.
 */
export interface SheetRef {
  kind: string;
  id: string;
}

export const MAX_STACK = 2;

const KIND = /^[a-z][a-z0-9-]*$/;

/** Parses one `kind:id` value (the id may contain colons). Null for anything malformed. */
export function parseSheet(value: string | null | undefined): SheetRef | null {
  if (!value) return null;
  const at = value.indexOf(":");
  const kind = at < 0 ? value : value.slice(0, at);
  return KIND.test(kind) ? { kind, id: at < 0 ? "" : value.slice(at + 1) } : null;
}

export const formatSheet = (s: SheetRef): string => (s.id ? `${s.kind}:${s.id}` : s.kind);

type Params = Pick<URLSearchParams, "getAll" | "get">;

/** The stacked sheets named by the address, bottom first, at most two (the last two when more are given). */
export function sheetsOf(sp: Params): SheetRef[] {
  const all = sp.getAll("sheet").flatMap((v) => {
    const s = parseSheet(v);
    return s ? [s] : [];
  });
  return all.slice(-MAX_STACK);
}

/** The step of the top sheet, one-based. 1 when absent or not a positive whole number. */
export function stepOf(sp: Params): number {
  const n = Number(sp.get("step"));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Puts a sheet on top. Opening what is already on top does nothing; a third sheet replaces the second. */
export function pushSheet(stack: SheetRef[], next: SheetRef): SheetRef[] {
  const top = stack[stack.length - 1];
  if (top && formatSheet(top) === formatSheet(next)) return stack;
  return stack.length >= MAX_STACK ? [stack[0], next] : [...stack, next];
}

/** Takes the top sheet off. */
export const popSheet = (stack: SheetRef[]): SheetRef[] => stack.slice(0, -1);

/** The query string for a stack and a step on the top sheet, keeping every other parameter of `base`. */
export function withSheets(base: URLSearchParams | string, stack: SheetRef[], step = 1): string {
  const q = new URLSearchParams(typeof base === "string" ? base : base.toString());
  q.delete("sheet");
  q.delete("step");
  for (const s of stack) q.append("sheet", formatSheet(s));
  if (stack.length && step > 1) q.set("step", String(step));
  return q.toString();
}
