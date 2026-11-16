"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api/v2/admin";
import type { QualityThresholds } from "@/lib/api/v2/admin";
import { formatModuleName } from "@/lib/format";
import { refreshAdmin, useQualityThresholds } from "@/lib/v2/admin-queries";
import { bandsFor } from "@/lib/v2/thresholds";
import { t as tr } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { ResultFrame, useOutcome } from "./shared";
import { Block, Loaded } from "./kit";
import { Button } from "@/design/next/kit";

const KEYS = ["target", "warning", "critical"] as const;
type Draft = Record<string, Record<(typeof KEYS)[number], string>>;

function ok(d: Draft[string]): boolean {
  const [t, w, c] = KEYS.map((k) => (d[k].trim() === "" ? NaN : Number(d[k])));
  return [t, w, c].every((v) => Number.isFinite(v) && v >= 0 && v <= 100) && c <= w && w <= t;
}

/** Where a dimension's bands come from for this scope: its own row, the tenant default, or the score bands. */
function source(q: QualityThresholds, scope: string, dim: string): "module" | "tenant" | "fallback" {
  if (scope !== "*" && q.modules[scope]?.[dim]) return "module";
  return q.tenant[dim] && JSON.stringify(q.tenant[dim]) !== JSON.stringify(q.fallback) ? "tenant" : "fallback";
}

function Table({ q, write, modules, scope, setScope }: { q: QualityThresholds; write: boolean; modules: string[]; scope: string; setScope: (s: string) => void }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("quality-thresholds");
  const draftOf = (s: string): Draft => Object.fromEntries(q.dimensions.map((d) => {
    const b = (s === "*" ? q.tenant[d] : bandsFor(q, s, d)) ?? q.fallback;
    return [d, { target: String(b.target), warning: String(b.warning), critical: String(b.critical) }];
  }));
  const [draft, setDraft] = useState<Draft>(() => draftOf(scope));
  const pick = (s: string) => { setScope(s); setDraft(draftOf(s)); };
  const save = (dim: string) => void run(`save-${dim}`, async () => {
    const d = draft[dim];
    await api.putQualityThreshold({ module: scope, dimension: dim, target: Number(d.target), warning: Number(d.warning), critical: Number(d.critical) });
    await refreshAdmin(qc, "settings");
    return { tone: "ok", title: tr("Thresholds saved"), detail: tr("Object and run screens show the new band at once. Scores do not change.") };
  });
  const clear = (dim: string) => void run(`clear-${dim}`, async () => {
    await api.deleteQualityThreshold(scope, dim);
    await refreshAdmin(qc, "settings");
    return { tone: "ok", title: tr("Override removed"), detail: scope === "*" ? tr("This dimension now uses the score bands.") : tr("This dimension now uses the tenant default.") };
  });
  const SRC = { module: tr("This module"), tenant: tr("Tenant default"), fallback: tr("Score bands") };
  return (
    <>
      <div className="nx-adm-rfilters">
        <label className="nx-adm-fld">
          <span >{tr("Applies to")}</span>
          <select className="nx-input" value={scope} onChange={(e) => pick(e.target.value)} data-testid="threshold-scope">
            <option value="*">{tr("All modules (tenant default)")}</option>
            {modules.map((m) => (
              <option key={m} value={m}>{formatModuleName(m)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="nx-card" tabIndex={0}>
        <table className="nx-table" data-testid="quality-thresholds" aria-label={tr("Quality thresholds")}>
          <thead>
            <tr className="nx-tr">
              <th className="nx-th" scope="col">{tr("Dimension")}</th>
              {KEYS.map((k) => <th key={k} scope="col" className="nx-th nx-end">{labelText(k)}</th>)}
              <th className="nx-th" scope="col">{tr("Set by")}</th>
              {write ? <th className="nx-th" scope="col"><span className="nx-sr">{tr("Actions")}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {q.dimensions.map((d) => {
              const src = source(q, scope, d);
              const own = scope === "*" ? src === "tenant" : src === "module";
              const good = ok(draft[d]);
              return (
                <tr className="nx-tr" key={d}>
                  <th className="nx-th" scope="row">{d === "overall" ? tr("Overall score") : labelText(d)}</th>
                  {KEYS.map((k) => (
                    <td key={k} className="nx-td nx-end">
                      {write ? (
                        <input className="nx-input" type="number" min={0} max={100} aria-label={tr("{dim} {band}", { dim: labelText(d), band: labelText(k) })} value={draft[d][k]} onChange={(e) => setDraft({ ...draft, [d]: { ...draft[d], [k]: e.target.value } })} />
                      ) : (
                        draft[d][k]
                      )}
                    </td>
                  ))}
                  <td className="nx-td">{SRC[src]}{write && !good ? <span className="nx-reason" role="alert">{" "}{tr("Critical must not exceed warning, and warning must not exceed target.")}</span> : null}</td>
                  {write ? (
                    <td className="nx-td">
                      <Button variant="primary" disabled={!good || pending !== null} onClick={() => save(d)}>
                        {pending === `save-${d}` ? tr("Saving…") : tr("Save")}
                      </Button>{" "}
                      {own ? (
                        <Button variant="quiet" disabled={pending !== null} onClick={() => clear(d)}>
                          {tr("Clear")}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/** Admin › Settings: Target, Warning and Critical per dimension, for the tenant and per module. Viewers see them read only. */
export function QualityThresholdsBlock({ write, modules }: { write: boolean; modules: string[] }) {
  const q = useQualityThresholds();
  // The scope outlives the table, which remounts on every refetch so its drafts start from the saved values.
  const [scope, setScope] = useState("*");
  return (
    <div id="quality-thresholds">
      <Block title={tr("Quality thresholds")} hint={tr("Each dimension and the overall score are held to a target, a warning line and a critical line. Set them once for the tenant and override them per module. Object and run screens show the band a score falls in.")}>
        <Loaded q={q} what={tr("The quality thresholds")} rows={4}>
          {(d) => <Table key={JSON.stringify(d)} q={d} write={write} modules={modules} scope={scope} setScope={setScope} />}
        </Loaded>
      </Block>
    </div>
  );
}

