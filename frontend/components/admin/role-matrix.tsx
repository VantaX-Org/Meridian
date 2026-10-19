"use client";

import { Tooltip, IconLock } from "@/design";
import type { Matrix, Pair } from "@/lib/api/roles";

/** Resources that ignore scope (rbac.md §2.3). */
const TENANT_WIDE = new Set(["users", "licence", "llm", "audit"]);

export function matrixToPairs(m: Matrix): Pair[] {
  return Object.entries(m).flatMap(([resource, acts]) => Object.entries(acts).filter(([, ok]) => ok).map(([action]) => ({ resource, action })));
}

/** Added / removed cells in `next` relative to `base`. */
export function matrixDiff(base: Matrix, next: Matrix): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const [r, acts] of Object.entries(next)) {
    for (const [a, ok] of Object.entries(acts)) {
      const was = !!base[r]?.[a];
      if (ok && !was) added++;
      if (!ok && was) removed++;
    }
  }
  return { added, removed };
}

/** Resource rows x action columns of checkboxes. Read-only unless `onChange` is given. */
export function RoleMatrix({ matrix, onChange, label, scoped = false }: { matrix: Matrix; onChange?: (m: Matrix) => void; label: string; /** A system or module scope is chosen, so tenant-wide rows get the lock. */ scoped?: boolean }) {
  const resources = Object.keys(matrix);
  const actions = Object.keys(matrix[resources[0]] ?? {});
  const toggle = (r: string, a: string) => onChange?.({ ...matrix, [r]: { ...matrix[r], [a]: !matrix[r][a] } });
  return (
    <div className="overflow-x-auto">
      <table className="m-text-meta" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="text-left pr-3">Resource</th>
            {actions.map((a) => <th key={a} scope="col" className="text-center px-2">{a}</th>)}
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r}>
              <th scope="row" className="text-left pr-3 py-1 font-normal">
                {r}
                {scoped && TENANT_WIDE.has(r) ? (
                  <span className="ml-1 align-middle">
                    <Tooltip label="Tenant-wide; scope does not apply." render={<button type="button" aria-label="Tenant-wide; scope does not apply." />}>
                      <IconLock size={12} />
                    </Tooltip>
                  </span>
                ) : null}
              </th>
              {actions.map((a) => (
                <td key={a} className="text-center">
                  <input
                    type="checkbox" checked={!!matrix[r][a]} disabled={!onChange}
                    aria-label={`${r} ${a}`} onChange={() => toggle(r, a)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
