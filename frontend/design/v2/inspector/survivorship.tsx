"use client";

import { useRef, useState } from "react";
import { labelOf } from "@/lib/format";
import { putSurvivorship } from "@/lib/api/v2/designer";
import type { SurvivorshipRule, SurvivorshipRuleType } from "@/lib/api/survivorship";
import { useV2Session } from "@/lib/v2/hooks";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { useRefreshV2, useSurvivorshipRules } from "@/lib/v2/sys-queries";
import { moduleFromSlug } from "@/lib/v2/score";
import { moveBy, needsSources, RULE_TYPES, toInput, typeLabel, validateRules, type DraftRule } from "@/lib/v2/survivorship";
import { Actions, InspectorFrame } from "../Inspector";
import { ConfirmBar, Field, Gate } from "../forms";
import { Mono, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { ResultFrame, useOutcome } from "./shared";
import { t as tr } from "@/lib/v2/i18n";

const fromRule = (r: SurvivorshipRule, i: number): DraftRule => ({ key: `r${i}`, field: r.field, rule_type: r.rule_type, trusted_sources: r.trusted_sources ?? [], weight: String(r.weight), active: r.active, ai_inferred: r.ai_inferred });

function Editor({ domain, initial }: { domain: string; initial: SurvivorshipRule[] }) {
  const { can } = useV2Session();
  const allowed = can("mdm.write");
  const systems = useSystemsExtended().data ?? [];
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const seq = useRef(initial.length);
  const [rules, setRules] = useState<DraftRule[]>(() => initial.map(fromRule));
  const [dirty, setDirty] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const errors = validateRules(rules);
  const valid = Object.keys(errors).length === 0;

  const change = (next: DraftRule[]) => {
    setRules(next);
    setDirty(true);
  };
  const patch = (key: string, p: Partial<DraftRule>) => change(rules.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const add = () => change([...rules, { key: `n${++seq.current}`, field: "", rule_type: "most_recent", trusted_sources: [], weight: "50", active: true }]);
  const save = () => {
    setShown(true);
    if (!valid || !allowed) return;
    void run("save", async () => {
      const saved = await putSurvivorship(domain, toInput(rules));
      setRules(saved.rules.map(fromRule));
      setDirty(false);
      setShown(false);
      refresh();
      return { tone: "ok", title: tr("Survivorship rules saved"), detail: tr("{total} {total, plural, one {rule} other {rules}} for {domain}. They apply from the next merge.", { total: saved.total, domain: labelOf(domain) }) };
    });
  };
  const gone = rules.find((r) => r.key === removing);

  return (
    <>
      {!allowed ? <Gate>{tr("Changing survivorship rules needs the MDM write permission. You can read them.")}</Gate> : null}
      <p className="m2-rp m2-meta">{tr("A rule decides which record's value survives in the golden record, field by field. A field with no rule keeps the survivor's value. Rules are listed by field.")}</p>
      {rules.length === 0 ? (
        <EmptyFrame>{tr("No survivorship rule is set for this object. Add one for a field.")}</EmptyFrame>
      ) : (
        <ul className="m2-sv" aria-label={tr("Survivorship rules")} data-testid="sv-list">
          {rules.map((r) => {
            const e = shown ? errors[r.key] ?? {} : {};
            return (
              <li key={r.key} aria-label={r.field || tr("New rule")}>
                <div className="m2-sv-h">
                  {r.field ? <Mono>{r.field}</Mono> : <span>{tr("New rule")}</span>}
                  <span className="m2-meta">{`${typeLabel(r.rule_type)}${r.ai_inferred ? tr(", suggested by the miner") : ""}`}</span>
                </div>
                <div className="m2-grid2">
                  <Field label={tr("Field")} error={e.field}>{(p) => <input {...p} className="m2-mono" disabled={!allowed} value={r.field} onChange={(ev) => patch(r.key, { field: ev.target.value })} />}</Field>
                  <Field label={tr("Rule type")} hint={RULE_TYPES.find((t) => t.value === r.rule_type)?.help}>
                    {(p) => (
                      <select {...p} disabled={!allowed} value={r.rule_type} onChange={(ev) => patch(r.key, { rule_type: ev.target.value as SurvivorshipRuleType })}>
                        {RULE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label={tr("Weight")} hint={tr("0 to 100")} error={e.weight}>{(p) => <input {...p} disabled={!allowed} inputMode="numeric" value={r.weight} onChange={(ev) => patch(r.key, { weight: ev.target.value })} />}</Field>
                  <label className="m2-chk" style={{ alignSelf: "end" }}>
                    <input type="checkbox" disabled={!allowed} checked={r.active} onChange={(ev) => patch(r.key, { active: ev.target.checked })} />
                    {tr("Active")}
                  </label>
                </div>
                {needsSources(r.rule_type) ? (
                  <div>
                    <p className="m2-rp">{r.rule_type === "chain" ? tr("Systems, in the order they are tried") : tr("Trusted systems, in priority order")}</p>
                    <ol className="m2-srcs" aria-label={tr("Systems for {field}", { field: r.field || tr("the new rule") })}>
                      {r.trusted_sources.map((s, k) => (
                        <li key={s}>
                          <span>{k + 1}</span>
                          <span style={{ flex: 1 }}>{s}</span>
                          {allowed ? (
                            <>
                              <button type="button" className="m2-mini" aria-label={tr("Move {s} up", { s })} disabled={k === 0} onClick={() => patch(r.key, { trusted_sources: moveBy(r.trusted_sources, k, -1) })}>{tr("Up")}</button>
                              <button type="button" className="m2-mini" aria-label={tr("Move {s} down", { s })} disabled={k === r.trusted_sources.length - 1} onClick={() => patch(r.key, { trusted_sources: moveBy(r.trusted_sources, k, 1) })}>{tr("Down")}</button>
                              <button type="button" className="m2-mini" aria-label={tr("Remove {s}", { s })} onClick={() => patch(r.key, { trusted_sources: r.trusted_sources.filter((x) => x !== s) })}>{tr("Remove")}</button>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    {allowed ? (
                      <Field label={tr("Add a system")} error={e.sources}>
                        {(p) => (
                          <select {...p} value="" onChange={(ev) => ev.target.value && patch(r.key, { trusted_sources: [...r.trusted_sources, ev.target.value] })}>
                            <option value="">{tr("Choose a system")}</option>
                            {systems.filter((s) => !r.trusted_sources.includes(s.name)).map((s) => (
                              <option key={s.id} value={s.name}>{s.name}</option>
                            ))}
                          </select>
                        )}
                      </Field>
                    ) : null}
                  </div>
                ) : null}
                {allowed ? (
                  <div className="m2-acts">
                    <button type="button" className="m2-btn m2-sm m2-ghost" aria-label={tr("Delete the rule for {field}", { field: r.field || tr("the new rule") })} onClick={() => setRemoving(r.key)}>{tr("Delete rule")}</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {gone ? (
        <ConfirmBar
          message={tr("The rule for {field} is removed when you save. A merge then keeps the survivor's value for that field.", { field: gone.field || tr("this field") })}
          confirmLabel={tr("Delete rule")}
          onConfirm={() => {
            change(rules.filter((r) => r.key !== gone.key));
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      {allowed ? (
        <Actions>
          <button type="button" className="m2-btn" onClick={add}>{tr("Add a rule")}</button>
          <button type="button" className="m2-btn m2-strong" disabled={!dirty || pending !== null} onClick={save}>
            {pending === "save" ? tr("Saving…") : tr("Save rules")}
          </button>
        </Actions>
      ) : null}
      {shown && !valid ? <p className="m2-ferr" role="alert">{tr("Fix the marked fields before saving.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/** `?open=survivorship:<module>`: add, change, reorder the systems of, and delete the survivorship rules of one object. */
export function SurvivorshipInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const domain = moduleFromSlug(id);
  const q = useSurvivorshipRules(domain);
  return (
    <InspectorFrame title={tr("Survivorship rules")} status={labelOf(domain)} onClose={onClose}>
      {q.isLoading ? <Skeleton width="100%" height={140} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{tr("The survivorship rules could not be read.")}</ErrorFrame> : <Editor key={domain} domain={domain} initial={q.data ?? []} />}
    </InspectorFrame>
  );
}
