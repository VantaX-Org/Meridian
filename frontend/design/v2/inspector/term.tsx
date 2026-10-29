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
      return { tone: "ok", title: "Term saved", detail: "The change is in the term's history." };
    });
  const approve = () =>
    void run("approve", async () => {
      if (t && t.status !== "active") await updateTerm(id, { status: "active" });
      await reviewTerm(id);
      await refreshV2(qc);
      return { tone: "ok", title: "Term approved", detail: "It is active and marked as reviewed today." };
    });

  return (
    <InspectorFrame title={t ? t.business_name : "Business term"} status={t ? `Business term, ${STATUS_WORD[t.status] ?? t.status}` : "Business term"} onClose={onClose}>
      {q.isError && !t ? (
        <ErrorFrame onRetry={() => void q.refetch()}>This term could not be read.</ErrorFrame>
      ) : !t ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={140} />
        </div>
      ) : (
        <>
          <Sec title="Facts">
            <FactList>
              <Fact label="Status">
                <TermStatus status={t.status} />
              </Fact>
              <Fact label="SAP field">
                <Mono>{t.technical_name}</Mono>
              </Fact>
              <Fact label="Owner">{owner?.owner_name ?? <Dash why="No owner is set for this object" />}</Fact>
              <Fact label="Steward">{owner?.steward_name ?? <Dash why="No steward is set for this object" />}</Fact>
              <Fact label="Mandatory for S/4HANA">{t.mandatory_for_s4hana ? "Yes" : "No"}</Fact>
              <Fact label="Last reviewed">{t.last_reviewed_at ? formatDate(t.last_reviewed_at, "date") : <Dash why="Never reviewed" />}</Fact>
              <Fact label="Review cycle">{`${t.review_cycle_days} days`}</Fact>
            </FactList>
          </Sec>
          <Sec title="Definition">
            {editing ? (
              <div className="m2-aform">
                <label>
                  Term
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  Definition
                  <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={4} />
                </label>
                <div className="m2-acts">
                  <button type="button" className="m2-btn m2-strong" disabled={name.trim() === "" || pending !== null} onClick={save}>
                    {pending === "save" ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="m2-btn" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="m2-rp">{t.business_definition ?? "No definition is written yet."}</p>
                {t.why_it_matters ? <p className="m2-rp m2-meta">{t.why_it_matters}</p> : null}
              </>
            )}
          </Sec>
          <Sec title={`Rules that cite it: ${t.linked_rules.length}`}>
            {t.linked_rules.length === 0 ? (
              <p className="m2-rp m2-meta">No rule cites this term yet.</p>
            ) : (
              <ul className="m2-lk" aria-label="Rules that cite this term">
                {t.linked_rules.map((r) => (
                  <li key={r.rule_id}>
                    <V2Link href={hrefFor({ kind: "rule", id: r.rule_id })} className="m2-mono">
                      {r.rule_id}
                    </V2Link>
                    <span className="m2-meta">{[r.severity, r.affected_count != null ? `${int(r.affected_count)} failing` : null, r.pass_rate != null ? `${f1(r.pass_rate)}% pass` : null].filter(Boolean).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Sec title="Fields">
            <ul className="m2-lk" aria-label="Fields this term governs">
              <li>
                <Mono>{`${t.sap_table}.${t.sap_field}`}</Mono>
                <span className="m2-meta">{describeField(`${t.sap_table}.${t.sap_field}`) ?? t.business_name}</span>
              </li>
            </ul>
          </Sec>
          <Sec title="Actions">
            {canManage ? (
              <div className="m2-acts">
                {!editing ? (
                  <button type="button" className="m2-btn" onClick={startEdit}>
                    Edit
                  </button>
                ) : null}
                <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={approve}>
                  {pending === "approve" ? "Approving…" : t.status === "active" ? "Mark as reviewed" : "Approve"}
                </button>
              </div>
            ) : (
              <>
                <p className="m2-rp m2-meta">Editing and approving a term needs the approve permission. A data owner can do both.</p>
              </>
            )}
            {outcome ? <ResultFrame outcome={outcome} /> : null}
          </Sec>
          <Sec title="History">
            {t.change_history.length === 0 ? (
              <p className="m2-rp m2-meta">No change is recorded for this term.</p>
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
