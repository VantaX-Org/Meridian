"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAttention } from "@/lib/api/v2/attention";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { startObjects, usePortfolio } from "@/lib/api/next/portfolio";
import { useLandscape } from "@/lib/v2/queries";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import {
  BarList, Button, Card, Confirm, EmptyState, ErrorState, FieldChip, MasterList, PageHeader, Skeleton, Split, StatTile, Stepper, useAletheia,
  useAletheiaScope, useToast, type Severity,
} from "@/ui/kit";
import { actionLabel, objectPath, sevOfScore, STEPS, stepLabel } from "./links";

const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));

/** The first screen: where the data stands, what needs a person, and which objects to work on next. */
export function Home() {
  useInterfaceLang();
  const fx = useFixture();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const land = useLandscape(null);
  const pf = usePortfolio({}, true);
  const att = useQuery({ queryKey: ["next", "home-attention", fx], queryFn: () => getAttention({}), staleTime: 30_000 });
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = (p: string) => withFixture(p, fx);

  const rows = pf.data?.objects ?? [];
  const systems = land.data?.systems ?? [];
  const worst = [...rows].filter((r) => r.composite_score !== null).sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0)).slice(0, 6);
  const byStep = STEPS.map((s) => ({ id: s, label: stepLabel(s), n: rows.filter((r) => (r.step ?? "pull") === s).length }));
  const s = land.data?.sentence;
  const sentence = s ? t("{held} of {n} objects score under 85, and {crit} critical rules are over their limit.", { held: s.held_under_85, n: s.objects, crit: s.critical_over_tolerance }) : "";

  useAletheiaScope({
    key: "home",
    label: t("Asking about all objects"),
    suggestions: [t("What needs me first?"), t("Which objects are closest to ready?")],
    answer: (p) => ({ text: p === t("Which objects are closest to ready?")
      ? [...rows].filter((r) => r.composite_score !== null).sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0)).slice(0, 3).map((r) => `${r.label}: ${Math.round(r.composite_score ?? 0)}`).join("; ") || t("No scored object yet.")
      : att.data?.items[0] ? `${att.data.items[0].title}. ${att.data.items[0].detail}` : t("Nothing needs you right now.") }),
  });

  const pullAll = async () => {
    setBusy(true);
    try {
      const r = await startObjects(rows.map((x) => x.module));
      toast(t("{n} objects queued for a new pull.", { n: r.queued.length }), "good");
      void qc.invalidateQueries({ queryKey: ["next", "portfolio"] });
    } catch {
      toast(t("The pull could not be started."), "bad");
    } finally {
      setBusy(false);
      setAsk(false);
    }
  };

  if (land.isLoading || pf.isLoading) return <Skeleton lines={8} label={t("Loading the home screen")} />;
  if (land.isError) return <ErrorState heading={t("The overview could not be loaded")} retryLabel={t("Try again")} onRetry={() => void land.refetch()} />;

  const items = att.data?.items ?? [];
  const attRows = items.slice(0, 8).map((i) => ({
    id: i.id,
    severity: (["critical", "high", "medium", "low"].includes(i.severity) ? i.severity : "low") as Severity,
    severityLabel: sevLabel(i.severity),
    text: `${i.title}. ${i.detail}`,
    countLabel: i.action_label,
  }));

  return (
    <>
      <PageHeader
        title={t("Home")}
        context={sentence}
        actions={<>
          <Button variant="primary" onClick={() => setAsk(true)} disabled={!rows.length || busy}>{t("Pull every object")}</Button>
          <Button variant="secondary" href={href("/o")}>{t("All objects")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <Split
        leftLabel={t("Where you stand")}
        rightLabel={t("What needs you")}
        left={<div className="mx-col">
          <dl className="mx-tiles">
            <StatTile label={t("Go")} value={land.data?.counts.go ?? 0} note={t("Ready to load")} />
            <StatTile label={t("At risk")} value={land.data?.counts.at_risk ?? 0} note={t("Close to ready")} />
            <StatTile label={t("No go")} value={land.data?.counts.no_go ?? 0} note={t("Held by critical rules")} />
          </dl>
          <Card title={t("Objects by cycle step")} sub={t("Pull, clean in Excel, upload, score, compare, repeat.")}>
            <Stepper steps={byStep.map((b) => ({ id: b.id, label: `${b.label} (${b.n})` }))} current={-1} label={t("Cycle steps")} />
          </Card>
          <Card title={t("Lowest scores")} sub={t("Open an object to see its failing rules.")}>
            {worst.length ? (
              <>
                <BarList label={t("Lowest scoring objects")} max={100} items={worst.map((r) => ({ id: r.module + r.system_id, label: r.label, value: r.composite_score ?? 0, display: `${Math.round(r.composite_score ?? 0)}`, sev: sevOfScore(r.composite_score) }))} />
                <ul className="mx-links" aria-label={t("Next action per object")}>
                  {worst.map((r) => (
                    <li key={r.module + r.system_id}>
                      <Button variant="secondary" href={href(objectPath(r, systems))}>{r.label}: {actionLabel(r)}</Button> <FieldChip code={r.module} description={r.label} />
                    </li>
                  ))}
                </ul>
              </>
            ) : <EmptyState heading={t("No objects have run yet")} body={t("Pull an object to see its score here.")} />}
          </Card>
        </div>}
        right={<div className="mx-col">
          <Card title={t("Needs your attention")} sub={att.data ? t("{n} items, most urgent first", { n: items.length }) : undefined}>
            {att.isError ? <ErrorState heading={t("The list could not be loaded")} retryLabel={t("Try again")} onRetry={() => void att.refetch()} />
              : attRows.length ? <MasterList label={t("Attention items")} rows={attRows} selectedId={null} onSelect={(id) => { const it = items.find((x) => x.id === id); if (it) router.push(href(it.href)); }} />
              : <EmptyState heading={t("Nothing needs you")} body={t("No approvals, failures or overdue items are waiting.")} />}
          </Card>
        </div>}
      />
      <Confirm open={ask} title={t("Pull every object?")} confirmLabel={t("Pull {n} objects", { n: rows.length })} cancelLabel={t("Cancel")} onConfirm={() => void pullAll()} onCancel={() => setAsk(false)}>
        <p>{t("Every object is read again from its system. This can take a while and is not stopped half way.")}</p>
      </Confirm>
    </>
  );
}
