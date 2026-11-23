"use client";

import { useRouter } from "next/navigation";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import type { VersionHead } from "@/lib/api/v2/runs";
import { Card, DataTable, EmptyState, ErrorState, Skeleton, Stepper, type Column } from "@/ui/kit";
import { dqsOf, score } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { objectPath, useTabChat } from "./TabFrame";

/** Every run of the object, newest first. Picking one makes it the run the other sub-screens show. */
export function Runs({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const router = useRouter();
  const fx = useFixture();
  useTabChat(system, module, "runs", o.label, [t("Which run scored best?")], () => {
    const best = [...o.heads].sort((a, b) => (dqsOf(b, module) ?? -1) - (dqsOf(a, module) ?? -1))[0];
    return { text: best ? t("Run {n} scored best with {s}.", { n: best.run_number ?? best.label ?? best.id, s: score(dqsOf(best, module) ?? 0) }) : t("There are no runs yet."), evidence: o.heads.slice(0, 3).map((h) => `${h.run_at.slice(0, 10)}: ${score(dqsOf(h, module) ?? 0)}`) };
  });
  if (o.runsLoading) return <Skeleton lines={5} label={t("Loading runs")} />;
  if (o.runsError) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={o.refetchRuns} />;
  const rows = o.heads.filter((h) => h.dqs_summary?.[module]);
  if (!rows.length) return <EmptyState heading={t("This object has no runs yet.")} />;
  // ponytail: the run list carries no cycle field, so the stepper shows the newest five runs oldest first.
  const steps = rows.slice(0, 5).reverse().map((h) => ({ id: h.id, label: h.label ?? `#${h.run_number ?? ""}` }));
  const cols: Column<VersionHead>[] = [
    { key: "n", label: t("Run"), render: (h) => <>{h.run_number ? `#${h.run_number} ` : ""}{h.label ?? ""}</>, sort: (h) => h.run_at },
    { key: "at", label: t("Date"), render: (h) => h.run_at.slice(0, 16).replace("T", " "), sort: (h) => h.run_at },
    { key: "s", label: t("Score"), align: "end", render: (h) => <span className="mx-num">{score(dqsOf(h, module) ?? 0)}</span>, sort: (h) => dqsOf(h, module) ?? 0 },
    { key: "c", label: t("Rules checked"), align: "end", render: (h) => <span className="mx-num">{h.dqs_summary?.[module]?.total_checks ?? 0}</span> },
    { key: "st", label: t("Status"), render: (h) => h.status },
    { key: "tr", label: t("Source"), render: (h) => h.metadata?.trigger ?? h.metadata?.source ?? "" },
  ];
  return (
    <div className="mx-col">
      <Card title={t("Latest runs")}><Stepper steps={steps} current={Math.max(0, steps.findIndex((x) => x.id === (o.runId ?? "")))} label={t("Latest runs")} /></Card>
      <Card title={t("All runs")} sub={t("Choose a run to see the other screens as of that run.")}>
        <DataTable columns={cols} rows={rows} rowKey={(h) => h.id} label={t("Runs")} selected={o.runId ?? undefined} onSelect={(h) => router.push(withFixture(o.hrefWith(objectPath(system, module, "runs"), { run: h.id }), fx))} />
      </Card>
    </div>
  );
}
