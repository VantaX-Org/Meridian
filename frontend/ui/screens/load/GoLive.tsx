"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useWaveGates } from "@/lib/v2/roles-queries";
import { putWaveGate, type GateCheck, type WaveGate } from "@/lib/api/v2/roles";
import { downloadCertificate, gateRefusalOf, issueCertificate, signCertificate, type GateRefusal } from "@/lib/api/v2/step9";
import { Button, Card, DataTable, EmptyState, Field, FieldChip, Input, PageHeader, Toggle, useAletheiaScope, useToast, ExportMenu } from "@/ui/kit";
import { AskButton, Gate, humanize, pct, useHref, Verdict, when, useBack } from "./common";
import { invalidateLoad, useCerts } from "./hooks";
import { useCrumbs, Flow, LOAD_STEPS } from "@/ui/screens/flow";

const checkLabel = (k: GateCheck["key"]): string => (k === "min_score" ? t("Minimum score") : k === "zero_criticals" ? t("No failing critical rule") : t("Contracts met"));

function Settings({ g, onDone }: { g: WaveGate; onDone: () => void }) {
  const toast = useToast();
  const [min, setMin] = useState(g.gate.min_score === null ? "" : String(g.gate.min_score));
  const [zero, setZero] = useState(g.gate.zero_criticals);
  const [con, setCon] = useState(g.gate.contracts_met);
  const save = useMutation({
    mutationFn: () => putWaveGate(g.wave_id, { min_score: min.trim() === "" ? null : Number(min), zero_criticals: zero, contracts_met: con }),
    onSuccess: () => { toast(t("Gate saved"), "good"); onDone(); },
    onError: () => toast(t("The gate could not be saved"), "bad"),
  });
  const bad = min.trim() !== "" && !(Number(min) >= 0 && Number(min) <= 100);
  return (
    <div className="mx-col">
      <Field label={t("Minimum score")} hint={t("A score from 0 to 100. Leave it empty for no minimum.")} error={bad ? t("Enter a score from 0 to 100") : undefined}><Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
      <Toggle label={t("No failing critical rule")} checked={zero} onChange={setZero} />
      <Toggle label={t("Contracts met")} checked={con} onChange={setCon} />
      <div className="mx-actions"><Button variant="secondary" disabled={bad || save.isPending} onClick={() => save.mutate()}>{t("Save gate")}</Button></div>
    </div>
  );
}

function Certificates({ g }: { g: WaveGate }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useCerts(g.wave_id);
  const [refusal, setRefusal] = useState<GateRefusal | null>(null);
  const issue = useMutation({
    mutationFn: () => issueCertificate(g.wave_id),
    onSuccess: () => { setRefusal(null); toast(t("Certificate issued"), "good"); invalidateLoad(qc); },
    onError: (e) => { const r = gateRefusalOf(e); if (r) setRefusal(r); else toast(t("The certificate could not be issued"), "bad"); },
  });
  const sign = useMutation({
    mutationFn: (id: string) => signCertificate(g.wave_id, id, null),
    onSuccess: () => { toast(t("Certificate signed"), "good"); invalidateLoad(qc); },
    onError: () => toast(t("The certificate could not be signed"), "bad"),
  });
  const vs = q.data?.versions ?? [];
  return (
    <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the certificates")}>
      <div className="mx-actions"><Button variant="primary" disabled={issue.isPending} onClick={() => issue.mutate()}>{t("Issue certificate")}</Button></div>
      {refusal ? (
        <div role="alert">
          <p>{refusal.detail}</p>
          <ul>{refusal.objects.map((o) => <li key={o.module}><FieldChip code={o.module} description={humanize(o.module)} /> <span className="mx-muted">{o.reason}</span></li>)}</ul>
        </div>
      ) : null}
      {vs.length ? (
        <DataTable
          label={t("Certificate versions")}
          rows={vs}
          rowKey={(v) => v.id}
          height={220}
          columns={[
            { key: "v", label: t("Version"), sort: (v) => v.version, render: (v) => `v${v.version}` },
            { key: "s", label: t("Status"), render: (v) => (v.status === "signed" ? t("Signed") : t("Issued")) },
            { key: "at", label: t("Issued on"), sort: (v) => v.issued_at, render: (v) => when(v.issued_at) },
            { key: "sig", label: t("Signed by"), render: (v) => v.signatures.map((s) => s.user ?? s.user_id).join(", ") || t("Nobody yet") },
            { key: "act", label: t("Actions"), render: (v) => (
              <span className="mx-links">
                {v.status === "issued" ? <Button variant="secondary" disabled={sign.isPending} onClick={() => sign.mutate(v.id)}>{t("Sign")}</Button> : null}
                <ExportMenu label={t("Download certificate")} formats={[{ id: "pdf", label: t("PDF certificate") }]} onExport={() => downloadCertificate(g.wave_id, v.id, v.version)} />
              </span>
            ) },
          ]}
        />
      ) : <EmptyState heading={t("No certificate yet")} body={t("Issue one when every gate check passes.")} />}
      {q.data?.required_signers.length ? <p className="mx-muted">{t("Required signers")}: {q.data.required_signers.map((s) => s.name).join(", ")}</p> : null}
    </Gate>
  );
}

/** Go-live readiness: every wave gate with its evidence, the gate settings and the readiness certificates. */
export function GoLive() {
  useInterfaceLang();
  const back = useBack();
  const q = useWaveGates();
  const qc = useQueryClient();
  const href = useHref();
  const [sel, setSel] = useState<string | null>(null);
  const gates = q.data?.gates ?? [];
  const g = gates.find((x) => x.wave_id === sel) ?? gates[0] ?? null;

  useAletheiaScope({
    key: "load/go-live",
    label: t("Asking about go-live readiness"),
    suggestions: [t("Which gate is blocking go-live?")],
    answer: () => {
      const f = gates.find((x) => !x.status.passed);
      return f
        ? { text: t("{wave} is blocked.", { wave: f.name }), evidence: f.status.checks.filter((c) => !c.passed).map((c) => `${checkLabel(c.key)}: ${c.detail}`) }
        : { text: t("Every configured gate passes."), evidence: [] };
    },
  });

  const crumbs = useCrumbs();
  return (
    <>
      <PageHeader crumbs={crumbs("load", t("Go-live readiness"))} stepper={<Flow label={t("Load journey")} at={4} steps={LOAD_STEPS()} />} back={back} title={t("Go-live readiness")} context={t("Each wave must pass its gate before it is signed off and certified.")} actions={<AskButton />} />
      <div className="mx-col">
      <Card title={t("Wave gates")} sub={t("{n} waves", { n: gates.length })}>
        <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the wave gates")}>
          {gates.length ? (
            <DataTable
              label={t("Wave gates")}
              rows={gates}
              rowKey={(x) => x.wave_id}
              height={240}
              selected={g?.wave_id ?? null}
              onSelect={(x) => setSel(x.wave_id)}
              columns={[
                { key: "n", label: t("Wave"), sort: (x) => x.name, render: (x) => <Link href={href(`/load/waves/${x.wave_id}`)}>{x.name}</Link> },
                { key: "m", label: t("Objects"), render: (x) => x.modules.map((m) => <FieldChip key={m} code={m} description={humanize(m)} />) },
                { key: "v", label: t("Verdict"), sort: (x) => Number(x.status.passed), render: (x) => <Verdict v={x.status.passed ? "go" : "no-go"} /> },
                { key: "c", label: t("Checks passed"), align: "end", render: (x) => `${x.status.checks.filter((c) => c.passed).length}/${x.status.checks.length}` },
                { key: "so", label: t("Signed off"), render: (x) => (x.signed_off ? t("Yes") : t("No")) },
              ]}
            />
          ) : <EmptyState heading={t("No wave yet")} body={t("A gate belongs to a wave. Plan a wave first.")} action={<Link href={href("/load/waves")}>{t("Open migration waves")}</Link>} />}
        </Gate>
      </Card>
      {g ? (
        <>
          <Card title={t("Gate checks for {wave}", { wave: g.name })}>
            <DataTable
              label={t("Gate checks")}
              rows={g.status.checks}
              rowKey={(c) => c.key}
              height={220}
              columns={[
                { key: "k", label: t("Check"), render: (c) => checkLabel(c.key) },
                { key: "p", label: t("Result"), render: (c) => <Verdict v={c.passed ? "go" : "no-go"} /> },
                { key: "a", label: t("Actual"), align: "end", render: (c) => (c.actual === null || c.actual === undefined ? t("n/a") : c.key === "min_score" ? pct(c.actual) : String(c.actual)) },
                { key: "th", label: t("Threshold"), align: "end", render: (c) => (c.threshold === null || c.threshold === undefined ? t("n/a") : c.key === "min_score" ? pct(c.threshold) : String(c.threshold)) },
                { key: "d", label: t("Detail"), render: (c) => (
                  <span>{c.detail}{c.items?.length ? <> {c.items.slice(0, 4).map((i, n) => (i.module || i.check_id || i.field)
                    ? <FieldChip key={n} code={i.field ?? i.check_id ?? i.module ?? ""} description={i.field_description ?? i.message ?? (i.module ? humanize(i.module) : undefined)} />
                    : <span key={n}>{i.name}</span>)}</> : null}</span>
                ) },
              ]}
            />
          </Card>
          <Card title={t("Gate settings")} sub={g.gate.updated_at ? t("Changed on {date}", { date: when(g.gate.updated_at) }) : t("Not configured")}>
            <Settings key={g.wave_id} g={g} onDone={() => { void qc.invalidateQueries({ queryKey: ["v2", "roles"] }); invalidateLoad(qc); }} />
          </Card>
          <Card title={t("Readiness certificate")}><Certificates key={g.wave_id} g={g} /></Card>
        </>
      ) : null}
      </div>
    </>
  );
}
