"use client";

import { Fragment } from "react";
import { formatDate } from "@/lib/format";
import { useStatus } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { Dot } from "../parts";

/** "11 m 42 s" from seconds; a dash is the caller's job for a missing value. */
export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

/** The status strip under the canvas: what the numbers on screen were made from. */
export function StatusStrip() {
  const q = useStatus();
  const s = q.data;
  const parts: string[] = s
    ? [
        s.run_at ? `Run ${formatDate(s.run_at, "datetime")}` : "No run yet",
        `${int(s.records_checked)} records checked`,
        `${int(s.rules_measured)} rules measured`,
        s.scored_in_s == null ? "" : `scored in ${duration(s.scored_in_s)}`,
        s.cost_model ? `cost model ${s.cost_model}` : "",
        s.licence_valid_to ? `licence valid to ${formatDate(s.licence_valid_to, "date")}` : "",
      ].filter(Boolean)
    : [];
  return (
    <div className="m2-status" data-testid="status-strip">
      <span className="m2-status-t">
        {q.isError ? (
          "The status line could not be read."
        ) : s ? (
          parts.map((p, i) => (
            <Fragment key={p}>
              {i > 0 ? <Dot /> : null}
              {p}
            </Fragment>
          ))
        ) : (
          <span className="m2-skel" style={{ width: 360, height: 12 }} aria-hidden="true" />
        )}
      </span>
    </div>
  );
}
