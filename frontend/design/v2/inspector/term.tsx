"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { reviewTerm, updateTerm } from "@/lib/api/v2/mdm";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useObjectOwners, useTerm } from "@/lib/v2/mdm-queries";
import { refreshV2 } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { f1, int } from "@/lib/v2/score";
import { Fact, InspectorFrame } from "../Inspector";
import { FactList, Sec } from "./mdm-parts";
import { Dash, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { STATUS_WORD, TermStatus } from "../screens/object/GlossaryTab";
import { ResultFrame, useOutcome } from "./shared";
import { t as tr } from "@/lib/v2/i18n";

/** `?open=term:<id>`: one business term, the rules that cite it, the field it governs, and what the owner can do. */
export function TermInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const q = useTerm(id);
  const owners = useObjectOwners();
  const { outcome, pending, run } = useOutcome();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const canManage = session.can("approve");
  const t = q.data;
  const owner = t ? owners.data?.find((o) => o.ref === t.domain) : undefined;

  const startEdit = () => {
    if (!t) return;
    setName(t.business_name);
    setDefinition(t.business_definition ?? "");
    setEditing(true);
  };
  const save = () =>
    void run("save", async () => {
      await updateTerm(id, { business_name: name.trim(), business_definition: definition.trim() });
      await refreshV2(qc);
      setEditing(false);
      return { tone: "ok", title: tr("Term saved"), detail: tr("The change is in the term's history.") };
    });
  const approve = () =>
    void run("approve", async () => {
      if (t && t.status !== "active") await updateTerm(id, { status: "active" });
      await reviewTerm(id);
      await refreshV2(qc);
      return { tone: "ok", title: tr("Term approved"), detail: tr("It is active and marked as reviewed today.") };
    });

  return (
    <InspectorFrame title={t ? t.business_name : tr("Business term")} status={t ? tr("Business term, {STATUS_WORD}", { STATUS_WORD: STATUS_WORD[t.status] ?? t.status }) : tr("Business term")} onClose={onClose}>
      {q.isError && !t ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("This term could not be read.")}</ErrorFrame>
      ) : !t ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={140} />
        </div>
      ) : (
        <>
          <Sec title={tr("Facts")}>
            <FactList>
              <Fact label={tr("Status")}>
                <TermStatus status={t.status} />
              </Fact>
              <Fact label={tr("SAP field")}>
                <Mono>{t.technical_name}</Mono>
              </Fact>
              <Fact label={tr("Owner")}>{owner?.owner_name ?? <Dash why={tr("No owner is set for this object")} />}</Fact>
              <Fact label={tr("Steward")}>{owner?.steward_name ?? <Dash why={tr("No steward is set for this object")} />}</Fact>
              <Fact label={tr("Mandatory for S/4HANA")}>{t.mandatory_for_s4hana ? tr("Yes") : tr("No")}</Fact>
              <Fact label={tr("Last reviewed")}>{t.last_reviewed_at ? formatDate(t.last_reviewed_at, "date") : <Dash why={tr("Never reviewed")} />}</Fact>
              <Fact label={tr("Review cycle")}>{tr("{review_cycle_days} days", { review_cycle_days: t.review_cycle_days })}</Fact>
            </FactList>
          </Sec>
          <Sec title={tr("Definition")}>
            {editing ? (
              <div className="m2-aform">
                <label>
                  {tr("Term")}
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  {tr("Definition")}
                  <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={4} />
                </label>
                <div className="m2-acts">
                  <button type="button" className="m2-btn m2-strong" disabled={name.trim() === "" || pending !== null} onClick={save}>
                    {pending === "save" ? tr("Saving…") : tr("Save")}
                  </button>
                  <button type="button" className="m2-btn" onClick={() => setEditing(false)}>
                    {tr("Cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="m2-rp">{t.business_definition ?? tr("No definition is written yet.")}</p>
                {t.why_it_matters ? <p className="m2-rp m2-meta">{t.why_it_matters}</p> : null}
              </>
            )}
          </Sec>
          <Sec title={tr("Rules that cite it: {linked_rulesCount}", { linked_rulesCount: t.linked_rules.length })}>
            {t.linked_rules.length === 0 ? (
              <p className="m2-rp m2-meta">{tr("No rule cites this term yet.")}</p>
            ) : (
              <ul className="m2-lk" aria-label={tr("Rules that cite this term")}>
                {t.linked_rules.map((r) => (
                  <li key={r.rule_id}>
                    <V2Link href={hrefFor({ kind: "rule", id: r.rule_id })} className="m2-mono">
                      {r.rule_id}
                    </V2Link>
                    <span className="m2-meta">{[r.severity, r.affected_count != null ? tr("{affected_count} failing", { affected_count: int(r.affected_count) }) : null, r.pass_rate != null ? tr("{pass_rate}% pass", { pass_rate: f1(r.pass_rate) }) : null].filter(Boolean).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title={tr("Fields")}>
            <ul className="m2-lk" aria-label={tr("Fields this term governs")}>
              <li>
                <Mono>{`${t.sap_table}.${t.sap_field}`}</Mono>
                <span className="m2-meta">{describeField(`${t.sap_table}.${t.sap_field}`) ?? t.business_name}</span>
              </li>
            </ul>
          </Sec>
          <Sec title={tr("Actions")}>
            {canManage ? (
              <div className="m2-acts">
                {!editing ? (
                  <button type="button" className="m2-btn" onClick={startEdit}>
                    {tr("Edit")}
                  </button>
                ) : null}
                <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={approve}>
                  {pending === "approve" ? tr("Approving…") : t.status === "active" ? tr("Mark as reviewed") : tr("Approve")}
                </button>
              </div>
            ) : (
              <>
                <p className="m2-rp m2-meta">{tr("Editing and approving a term needs the approve permission. A data owner can do both.")}</p>
              </>
            )}
            {outcome ? <ResultFrame outcome={outcome} /> : null}
          </Sec>
          <Sec title={tr("History")}>
            {t.change_history.length === 0 ? (
              <p className="m2-rp m2-meta">{tr("No change is recorded for this term.")}</p>
            ) : (
              <ul className="m2-hist">
                {t.change_history.map((h) => (
                  <li key={h.id}>
                    <span className="m2-d">{formatDate(h.changed_at, "date")}</span>
                    <span>{`${h.changed_by}: ${h.field_changed.replace(/_/g, " ")}${h.change_reason ? `, ${h.change_reason}` : ""}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}
