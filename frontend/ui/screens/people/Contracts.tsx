"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { activateContract, createContract, getContractDetail, listContracts, reviseContract, type Contract } from "@/lib/api/v2/roles";
import { getContractBreaches, getContractCompliance } from "@/lib/api/v2/step9";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Chip, DataTable, EmptyState, Field, Input, PageHeader, Split, StatTile, useAletheia, useAletheiaScope, useToast } from "@/ui/kit";
import { CommentsPanel } from "./Comments";
import { Gate, day, refreshV2, useQ } from "./common";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
const status = (s: string) => s.replace(/_/g, " ");

function NewContract({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [producer, setProducer] = useState("");
  const [consumer, setConsumer] = useState("");
  const [desc, setDesc] = useState("");
  const make = useMutation({
    mutationFn: () => createContract({ name: name.trim(), producer: producer.trim(), consumer: consumer.trim(), description: desc.trim() || undefined }),
    onSuccess: () => { toast(t("Contract created"), "good"); void refreshV2(qc); onDone(); },
  });
  const ok = name.trim() && producer.trim() && consumer.trim();
  return (
    <Card title={t("New contract")}>
      <div className="mx-col">
        <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("Producer")} hint={t("The team that supplies the data")}><Input value={producer} onChange={(e) => setProducer(e.target.value)} /></Field>
        <Field label={t("Consumer")} hint={t("The team that relies on it")}><Input value={consumer} onChange={(e) => setConsumer(e.target.value)} /></Field>
        <Field label={t("Description")} hint={t("Optional")}><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        {make.isError ? <p role="alert" className="mx-muted">{t("The contract could not be created")}</p> : null}
        <div className="mx-head-actions">
          <Button variant="primary" disabled={!ok || make.isPending} onClick={() => make.mutate()}>{t("Create contract")}</Button>
          <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        </div>
      </div>
    </Card>
  );
}

function ContractDetailPane({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useQ(["contract", id], () => getContractDetail(id));
  const breaches = useQ(["contract-breaches", id], () => getContractBreaches(id));
  const compliance = useQ(["contract-compliance", id], () => getContractCompliance(id));
  const [note, setNote] = useState("");
  const done = (msg: string) => { toast(msg, "good"); void refreshV2(qc); };
  const activate = useMutation({ mutationFn: () => activateContract(id), onSuccess: () => done(t("Contract activated")) });
  const revise = useMutation({ mutationFn: () => reviseContract(id, note.trim() || undefined), onSuccess: () => { setNote(""); done(t("New version created")); } });
  return (
    <Gate q={detail} label={t("Loading contract")}>
      {(d) => {
        const c = d.contract;
        return (
          <div className="mx-col">
            <h2 className="mx-card-t">{c.name}</h2>
            {c.description ? <p className="mx-muted">{c.description}</p> : null}
            <dl className="mx-tiles">
              <StatTile label={t("Status")} value={status(c.status)} />
              <StatTile label={t("Version")} value={c.version} />
              <StatTile label={t("Compliant")} value={c.latest_compliant === null ? t("Not checked") : c.latest_compliant ? t("Yes") : t("No")} note={c.last_checked ? relTime(c.last_checked) : undefined} />
              <StatTile label={t("Checks")} value={d.checks} />
            </dl>
            <p>{t("Producer")}: {c.producer}. {t("Consumer")}: {c.consumer}.</p>
            <div className="mx-head-actions">
              {c.status !== "active" ? <Button variant="primary" disabled={activate.isPending} onClick={() => activate.mutate()}>{t("Activate")}</Button> : null}
            </div>
            <Card title={t("Revise")} sub={t("Creates a new version and keeps the old one")}>
              <Field label={t("What changed")} hint={t("Optional")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Button variant="secondary" disabled={revise.isPending} onClick={() => revise.mutate()}>{t("Create new version")}</Button>
            </Card>
            <Card title={t("Contract terms")} sub={t("Read only here")}>
              <Gate q={breaches} label={t("Loading terms")}>
                {(b) => (
                  <>
                    <p>{b.enforce ? t("Enforced on load") : t("Not enforced")}</p>
                    <ul className="mx-list" aria-label={t("Thresholds")}>
                      {b.thresholds.min_score !== undefined ? <li>{t("Minimum score")}: {b.thresholds.min_score}</li> : null}
                      {b.thresholds.max_critical_breaches !== undefined ? <li>{t("Critical breaches allowed")}: {b.thresholds.max_critical_breaches}</li> : null}
                      {Object.entries(b.thresholds.dimensions ?? {}).map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}
                    </ul>
                    <h3 className="mx-card-t">{t("Breaches now")}</h3>
                    {b.current.length === 0 ? <EmptyState heading={t("No breach right now")} /> : (
                      <ul className="mx-list" aria-label={t("Breaches now")}>{b.current.map((x, i) => <li key={i}>{x.metric}: {x.actual} {t("against")} {x.threshold}</li>)}</ul>
                    )}
                    <h3 className="mx-card-t">{t("Breach history")}</h3>
                    {b.history.length === 0 ? <EmptyState heading={t("No past breaches")} /> : (
                      <ul className="mx-list" aria-label={t("Breach history")}>{b.history.slice(0, 10).map((x) => <li key={`${x.run_id}-${x.metric}`}>{day(x.run_at)} {x.metric}: {x.actual} {t("against")} {x.threshold}</li>)}</ul>
                    )}
                  </>
                )}
              </Gate>
            </Card>
            <Card title={t("Compliance over time")}>
              <Gate q={compliance} label={t("Loading compliance")}>
                {(cm) => cm.compliance_history.length === 0 ? <EmptyState heading={t("No checks yet")} body={t("Compliance is recorded each time the contract is checked.")} /> : (
                  <DataTable
                    label={t("Compliance history")}
                    rows={cm.compliance_history}
                    rowKey={(r) => r.id}
                    height={240}
                    columns={[
                      { key: "at", label: t("Checked"), render: (r) => day(r.recorded_at) },
                      { key: "ok", label: t("Compliant"), render: (r) => (r.overall_compliant ? t("Yes") : t("No")) },
                      ...DIMS.map((k) => ({ key: k, label: k, align: "end" as const, render: (r: (typeof cm.compliance_history)[number]) => { const v = r[`${k}_actual` as const]; return v === null || v === undefined ? "" : `${Math.round(v <= 1 ? v * 100 : v)}%`; } })),
                    ]}
                  />
                )}
              </Gate>
            </Card>
            <Card title={t("Versions")}>
              <ul className="mx-list" aria-label={t("Versions")}>
                {d.versions.map((v) => <li key={v.version}>{t("Version {n}", { n: v.version })}, {day(v.created_at)}{v.note ? `, ${v.note}` : ""}</li>)}
              </ul>
            </Card>
            <CommentsPanel kind="contract" id={id} />
          </div>
        );
      }}
    </Gate>
  );
}

export function Contracts() {
  const q = useQ(["contracts"], () => listContracts());
  const chat = useAletheia();
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");
  const rows = (q.data?.contracts ?? []).filter((c) => filter === "all" || c.status === filter);
  useAletheiaScope({
    key: "contracts",
    label: t("Data contracts"),
    suggestions: [t("Which contracts are not compliant?")],
    answer: () => {
      const bad = (q.data?.contracts ?? []).filter((c) => c.latest_compliant === false);
      return { text: bad.length ? t("{n} contracts are not compliant: {names}.", { n: bad.length, names: bad.map((c) => c.name).join(", ") }) : t("Every checked contract is compliant.") };
    },
  });
  const left = (
    <div className="mx-col">
      <div className="mx-row" role="group" aria-label={t("Filter by status")}>
        {["all", "draft", "pending_approval", "active", "expired"].map((s) => <Chip key={s} selected={filter === s} onClick={() => setFilter(s)}>{s === "all" ? t("All") : status(s)}</Chip>)}
      </div>
      <Gate q={q} label={t("Loading contracts")}>
        {() => rows.length === 0 ? <EmptyState heading={t("No contracts")} body={t("Create the first contract between a producer and a consumer.")} /> : (
          <DataTable<Contract>
            label={t("Contracts")}
            rows={rows}
            rowKey={(c) => c.id}
            selected={sel ?? undefined}
            onSelect={(c) => { setSel(c.id); setAdding(false); }}
            columns={[
              { key: "name", label: t("Contract"), sort: (c) => c.name, render: (c) => c.name },
              { key: "route", label: t("Producer to consumer"), render: (c) => `${c.producer} ${t("to")} ${c.consumer}` },
              { key: "status", label: t("Status"), sort: (c) => c.status, render: (c) => status(c.status) },
              { key: "ok", label: t("Compliant"), render: (c) => (c.latest_compliant === null ? t("Not checked") : c.latest_compliant ? t("Yes") : t("No")) },
            ]}
          />
        )}
      </Gate>
    </div>
  );
  const right = adding ? <NewContract onDone={() => setAdding(false)} /> : sel ? <ContractDetailPane id={sel} /> : <EmptyState heading={t("Select a contract")} body={t("Its terms, breaches and notes appear here.")} />;
  return (
    <>
      <PageHeader title={t("Data contracts")} context={t("What producers promise and consumers rely on")} actions={<>
        <Button variant="primary" onClick={() => setAdding(true)}>{t("New contract")}</Button>
        <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
      </>} />
      <Split left={left} right={right} leftLabel={t("Contracts")} rightLabel={t("Contract detail")} />
    </>
  );
}
