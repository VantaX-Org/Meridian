"use client";

/** F3: other materials that look like this one. */

import Link from "next/link";
import { EmptyState, Mono, SectionCard } from "@/components/ui-core";
import type { MaterialDuplicates } from "@/lib/api/materials";

export function MaterialDuplicatesCard({ d }: { d: MaterialDuplicates }) {
  return (
    <SectionCard title="Possible duplicates"
      meta={`${d.algorithm.split(":")[0].replace(/_/g, " ")}, match threshold ${d.threshold}`}>
      {d.items.length === 0 ? (
        <EmptyState>No other material is within the match threshold on description, EAN or old material number.</EmptyState>
      ) : (
        <div className="ui-matrix-scroll">
          <table className="ui-mini-table" aria-label="Possible duplicate materials">
            <thead>
              <tr><th>Material</th><th>Description</th><th>Type</th><th>Group</th><th>Base</th><th>EAN</th><th>Matches on</th><th>Score</th></tr>
            </thead>
            <tbody>
              {d.items.map((r) => (
                <tr key={r.matnr}>
                  <td><Link className="ui-link" href={`/analyse/material/${encodeURIComponent(r.matnr)}`}><Mono>{r.matnr}</Mono></Link></td>
                  <td>{r.maktx ?? "—"}</td>
                  <td><Mono>{r.mtart ?? "—"}</Mono></td>
                  <td><Mono>{r.matkl ?? "—"}</Mono></td>
                  <td><Mono>{r.meins ?? "—"}</Mono></td>
                  <td><Mono>{r.ean11 ?? "—"}</Mono></td>
                  <td>{r.matches_on.join(", ")}</td>
                  <td className="aurora-number">{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
