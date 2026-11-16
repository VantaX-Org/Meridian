"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { activateContract, createContract, reviseContract, updateContract, type Contract } from "@/lib/api/v2/roles";
import { getContractBreaches, getContractCompliance } from "@/lib/api/v2/step9";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useContract, useContracts } from "@/lib/v2/roles-queries";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { CollabSections, Dash } from "./panels-kit";

/**
 * Data contracts for owners and approvers: `?open=contracts` lists them and creates one; `?open=contract:<id>` is one
 * contract with its compliance, breaches and versions, and the verbs its status allows: edit and submit
 * (manage_rules), approve (approve, never the author), revise into a new version.
 */

const STATUS: Record<string, () => string> = { draft: () => t("Draft"), pending_approval: () => t("Waiting for approval"), active: () => t("Active"), expired: () => t("Expired") };
const statusWord = (s: string) => STATUS[s]?.() ?? s;

function Compliance({ c }: { c: Contract }) {
  if (c.latest_compliant === null) return <Dash why={t("Not checked yet")} />;
  return <Chip tone={c.latest_compliant ? "good" : "bad"}>{c.latest_compliant ? t("Met") : t("Breached")}</Chip>;
}

/** GET /contracts/{id}/breaches and /compliance: the thresholds breached now, earlier runs that breached them, and the recent checks. */
function ContractChecks({ id }: { id: string }) {
  const fx = useFixture();
  const br = useQuery({ queryKey: ["v2", "contract-breaches", fx, id], queryFn: () => getContractBreaches(id), retry: false });
  const co = useQuery({ queryKey: ["v2", "contract-compliance", fx, id], queryFn: () => getContractCompliance(id), retry: false });
  const rows = co.data?.compliance_history ?? [];
  return (
    <>
      <section className="nx-ib-sec" aria-label={t("Thresholds breached")}>
        <h3>{t("Thresholds breached")}</h3>
        {br.data && br.data.current.length + br.data.history.length > 0 ? (
          <ul className="nx-ib-list" data-testid="contract-threshold-breaches">
            {br.data.current.map((b, i) => (
              <li key={`c${i}`} className="nx-ib-row">
                <span className="nx-pn-meta">{t("Now")}</span>
                <span>{t("{metric}: {actual} against {threshold}", { metric: b.metric, actual: b.actual ?? "-", threshold: b.threshold })}</span>
                {b.run_id ? <V2Link href={`/run/${encodeURIComponent(b.run_id)}`}>{t("Open the run")}</V2Link> : null}
              </li>
            ))}
            {br.data.history.map((b, i) => (
              <li key={`h${i}`} className="nx-ib-row">
                <span className="nx-pn-meta">{b.run_at ? formatDate(b.run_at, "date") : <Dash why={t("No date")} />}</span>
                <span>{t("{metric}: {actual} against {threshold}", { metric: b.metric, actual: b.actual ?? "-", threshold: b.threshold })}</span>
                {b.run_id ? <V2Link href={`/run/${encodeURIComponent(b.run_id)}`}>{t("Open the run")}</V2Link> : null}
              </li>
            ))}
          </ul>
        ) : br.isLoading ? (
          <Skeleton lines={2} label={t("Thresholds breached")} />
        ) : (
          <p className="nx-pn-meta">{t("No threshold is breached.")}</p>
        )}
      </section>
      <section className="nx-ib-sec" aria-label={t("Recent checks")}>
        <h3>{t("Recent checks")}</h3>
        {rows.length > 0 ? (
          <div className="nx-pn-scroll" tabIndex={0}>
            <table className="nx-pn-table" data-testid="contract-compliance">
              <thead>
                <tr>
                  <th scope="col">{t("Checked")}</th>
                  <th scope="col">{t("Completeness")}</th>
                  <th scope="col">{t("Accuracy")}</th>
                  <th scope="col">{t("Consistency")}</th>
                  <th scope="col">{t("Timeliness")}</th>
                  <th scope="col">{t("Uniqueness")}</th>
                  <th scope="col">{t("Validity")}</th>
                  <th scope="col">{t("Result")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.recorded_at, "date")}</td>
                    {[r.completeness_actual, r.accuracy_actual, r.consistency_actual, r.timeliness_actual, r.uniqueness_actual, r.validity_actual].map((v, i) => (
                      <td key={i} className="nx-pn-num">
                        {v === null ? <Dash why={t("Not measured")} /> : Math.round(Number(v))}
                      </td>
                    ))}
                    <td>{r.overall_compliant ? t("Met") : t("Breached")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : co.isLoading ? (
          <Skeleton lines={2} label={t("Recent checks")} />
        ) : (
          <p className="nx-pn-meta">{t("No check in the last 90 days.")}</p>
        )}
      </section>
    </>
  );
}

export function ContractsBody({ onClose }: BodyProps) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor, openItem } = useOpenItem();
  const q = useContracts();
  const [name, setName] = useState("");
  const [producer, setProducer] = useState("");
  const [consumer, setConsumer] = useState("");
  const [minScore, setMinScore] = useState("85");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreate = session.can("manage_rules") && !session.shared && !session.viewAs;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await createContract({ name, producer, consumer, quality_contract: { module: producer, min_score: Number(minScore) } });
      setName("");
      await refreshRoles(qc, "contracts");
      openItem({ kind: "contract", id: r.id });
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <InspectorFrame title={t("Data contracts")} status={t("What each consumer is promised")} onClose={onClose}>
      {q.isError ? (
        notFound(q.error) ? (
          <Dash why={t("Contracts are not available on this server")} />
        ) : (
          <ErrorState sentence={t("The contracts could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : !q.data ? (
        <Skeleton lines={3} label={t("Data contracts")} />
      ) : q.data.contracts.length === 0 ? (
        <EmptyState heading={t("No contract yet.")} />
      ) : (
        <ul className="nx-ib-list" data-testid="contracts-list">
          {q.data.contracts.map((c) => (
            <li key={c.id} className="nx-ib-row">
              <V2Link href={hrefFor({ kind: "contract", id: c.id })}>{c.name}</V2Link>
              <span className="nx-pn-meta">{t("{STATUS}, version {version}, {producer} to {consumer}", { STATUS: statusWord(c.status), version: c.version, producer: moduleText(c.producer), consumer: c.consumer })}</span>
              <Compliance c={c} />
            </li>
          ))}
        </ul>
      )}
      <section className="nx-ib-sec" aria-label={t("New contract")}>
        <h3>{t("New contract")}</h3>
        {canCreate ? (
          <div className="nx-pn-form" data-testid="contract-form">
            <label className="nx-pn-fld">
              <span>{t("Name")}</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Producer (object)")}</span>
              <input type="text" value={producer} onChange={(e) => setProducer(e.target.value)} placeholder="material_master" />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Consumer")}</span>
              <input type="text" value={consumer} onChange={(e) => setConsumer(e.target.value)} placeholder={t("S/4HANA migration")} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Minimum score")}</span>
              <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
            </label>
            <span>
              <Button variant="secondary" size={32} loading={busy} disabled={!name.trim() || !producer.trim() || !consumer.trim()} onClick={() => void create()}>
                {t("Create a draft")}
              </Button>
            </span>
            {error ? (
              <span className="nx-pn-err" role="alert">
                {error}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="nx-pn-meta">{t("Creating a contract needs the manage rules permission.")}</p>
        )}
      </section>
    </InspectorFrame>
  );
}

export function ContractBody({ id, onClose }: BodyProps) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const q = useContract(id);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const live = !session.shared && !session.viewAs;
  const act = async (fn: () => Promise<unknown>, said: string) => {
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(said);
      await refreshRoles(qc, "contracts");
    } catch (e) {
      setError(failureText(e));
    }
  };
  const c = q.data?.contract;
  const status = c ? t("{STATUS}, version {version}", { STATUS: statusWord(c.status), version: c.version }) : t("Data contract");
  const own = c?.created_by === session.id;
  return (
    <InspectorFrame title={c?.name ?? t("Data contract")} status={status} onClose={onClose}>
      {q.isError ? (
        notFound(q.error) ? (
          <EmptyState heading={t("This contract does not exist.")} />
        ) : (
          <ErrorState sentence={t("The contract could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : !q.data || !c ? (
        <Skeleton lines={4} label={t("Data contract")} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Producer")}>{moduleText(c.producer)}</Fact>
            <Fact label={t("Consumer")}>{c.consumer}</Fact>
            <Fact label={t("Promise")}>{c.quality_contract && typeof c.quality_contract.min_score === "number" ? t("Score at {min_score} or more", { min_score: c.quality_contract.min_score }) : <Dash why={t("No quality promise")} />}</Fact>
            <Fact label={t("Compliance")}>
              <Compliance c={c} />
            </Fact>
            <Fact label={t("Checked")}>{c.last_checked ? t("{last_checked}, {checks} checks in all", { last_checked: formatDate(c.last_checked, "date"), checks: q.data.checks }) : <Dash why={t("Not checked yet")} />}</Fact>
          </Facts>
          {live ? (
            <Actions>
              {(c.status === "draft" || c.status === "pending_approval") && session.can("manage_rules") ? (
                <>
                  <label className="nx-pn-fld">
                    <span>{t("Description")}</span>
                    <input type="text" value={desc ?? c.description ?? ""} onChange={(e) => setDesc(e.target.value)} />
                  </label>
                  <Button variant="secondary" size={32} disabled={desc === null} onClick={() => void act(() => updateContract(c.id, { description: desc ?? "" }), t("Saved."))}>
                    {t("Save")}
                  </Button>
                </>
              ) : null}
              {c.status === "draft" && session.can("manage_rules") ? (
                <Button variant="secondary" size={32} onClick={() => void act(() => updateContract(c.id, { status: "pending_approval" }), t("Sent for approval."))}>
                  {t("Submit for approval")}
                </Button>
              ) : null}
              {c.status === "pending_approval" && session.can("approve") ? (
                <Button variant="primary" size={32} disabled={own} reason={own ? t("Four eyes: you wrote it") : undefined} onClick={() => void act(() => activateContract(c.id), t("Approved: the contract is active."))}>
                  {t("Approve")}
                </Button>
              ) : null}
              {c.status === "active" && session.can("manage_rules") ? (
                <Button variant="secondary" size={32} onClick={() => void act(() => reviseContract(c.id), t("Version {count} opened as a draft.", { count: c.version + 1 }))}>
                  {t("Revise as a new version")}
                </Button>
              ) : null}
              {error ? (
                <span className="nx-pn-err" role="alert">
                  {error}
                </span>
              ) : null}
              {note ? <span role="status">{note}</span> : null}
            </Actions>
          ) : null}
          <section className="nx-ib-sec" aria-label={t("Breaches")}>
            <h3>{t("Breaches")}</h3>
            {q.data.breaches.length === 0 ? (
              <p className="nx-pn-meta">{t("No check has failed.")}</p>
            ) : (
              <ul className="nx-ib-list" data-testid="contract-breaches">
                {q.data.breaches.map((b, i) => (
                  <li key={`${b.recorded_at}-${i}`} className="nx-ib-row">
                    <span className="nx-pn-meta">{formatDate(b.recorded_at, "date")}</span>
                    <span>{Array.isArray(b.violations) ? t("{violationsCount} {violationsCount, plural, one {promise} other {promises}} not met", { violationsCount: b.violations.length }) : t("Not met")}</span>
                    {b.version_id ? <V2Link href={`/run/${encodeURIComponent(b.version_id)}`}>{t("Open the run")}</V2Link> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ContractChecks id={c.id} />
          <section className="nx-ib-sec" aria-label={t("Versions")}>
            <h3>{t("Versions")}</h3>
            <ul className="nx-ib-list" data-testid="contract-versions">
              <li className="nx-ib-row">
                <span className="nx-pn-meta">{t("Version {version}", { version: c.version })}</span>
                <span>{t("Live, {STATUS}", { STATUS: statusWord(c.status) })}</span>
              </li>
              {q.data.versions.map((v) => (
                <li key={v.version} className="nx-ib-row">
                  <span className="nx-pn-meta">{t("Version {version}, {created_at}", { version: v.version, created_at: formatDate(v.created_at, "date") })}</span>
                  <span>{v.note ?? t("Kept when the contract was revised")}</span>
                </li>
              ))}
            </ul>
          </section>
          <CollabSections kind="contract" id={c.id} label={t("this contract")} />
          <p className="nx-pn-meta">
            <V2Link href={hrefFor({ kind: "contracts", id: "" })}>{t("All contracts")}</V2Link>
          </p>
        </>
      )}
    </InspectorFrame>
  );
}
