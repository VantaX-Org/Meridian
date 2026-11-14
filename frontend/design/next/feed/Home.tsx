"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { V2Link } from "@/design/v2/parts";
import { errorSentence } from "@/lib/api/v2/client";
import { analyseRun } from "@/lib/api/v2/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { getFindings, type AletheiaFinding } from "@/lib/api/v2/insights";
import { downloadWorkbook, startObjects, usePortfolio, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Confirm, EmptyState, ErrorState, useToast, Button } from "../kit";
import type { PortfolioActions } from "../portfolio/BulkBar";
import { UploadPanel } from "../panels/UploadPanel";
import { registerSheet, useSheets } from "../shell/SheetHost";
import { Greeting } from "./Greeting";
import { ObjectsSheet } from "./ObjectsSheet";
import { orderFeed, runningNow } from "./model";
import { QuietRow } from "./QuietRow";
import { StoryCard } from "./StoryCard";
import { StoryCardSkeleton } from "./StoryCardSkeleton";
import { CapNotice } from "./CapNotice";
import "./feed.css";

// The Objects switcher opens from the greeting; registered here so SheetHost and sheets.ts stay free of a cycle.
registerSheet("objects", ({ close }) => <ObjectsSheet onClose={close} />);

/** Home: a greeting, the objects that need you in order, one action each, then the quiet ones. */
export function Home() {
  const session = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const sheets = useSheets();
  const fixture = useFixture();
  const systems = useSystemsExtended().data ?? [];
  const [all, setAll] = useState(false);
  const feed = usePortfolio({ limit: 500 }, all);
  const found = useQuery({ queryKey: ["aletheia-found", fixture, "home"], queryFn: () => getFindings(), staleTime: 60_000 });
  const [pulling, setPulling] = useState<PortfolioRow[] | null>(null);
  const [uploadFor, setUploadFor] = useState<PortfolioRow[] | null>(null);
  const [scoring, setScoring] = useState<Set<string>>(new Set());
  const pullBusy = useRef(false);

  const rows = useMemo(() => feed.data?.objects ?? [], [feed.data]);
  const { needs, quiet } = useMemo(() => orderFeed(rows, session.persona), [rows, session.persona]);
  const top = useMemo(() => {
    const m = new Map<string, AletheiaFinding>();
    for (const f of [...(found.data?.findings ?? [])].sort((a, b) => b.impact - a.impact)) if (!m.has(f.module)) m.set(f.module, f);
    return m;
  }, [found.data]);
  const count = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of found.data?.findings ?? []) m.set(f.module, (m.get(f.module) ?? 0) + 1);
    return m;
  }, [found.data]);
  const sysName = (id: string | null) => systems.find((s) => s.id === id)?.name ?? id ?? t("Unknown system");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["next", "portfolio"] });

  const act: PortfolioActions = {
    sysName,
    can: session.can,
    scoring,
    pull: (rs) => setPulling(rs),
    upload: (rs) => setUploadFor(rs),
    compare: () => sheets.open({ kind: "compare", id: "" }),
    download: async (rs) => {
      for (const r of rs) {
        try {
          await downloadWorkbook(r);
        } catch (err) {
          toast({ text: errorSentence(err, t("The workbook could not be downloaded. Try again.")), tone: "bad" });
          return;
        }
      }
      toast({ text: t("Workbook for run {n} downloaded. Upload it when you are done.", { n: formatInt(rs[0]?.run_number ?? 0) }), tone: "good" });
    },
    score: async (rs) => {
      setScoring((s) => new Set([...s, ...rs.map((r) => r.version_id)]));
      const out = await Promise.allSettled(rs.map((r) => analyseRun(r.version_id)));
      // A failed score frees its button again; a started one stays locked until the refreshed row shows the new run.
      const freed = rs.filter((_, i) => out[i].status === "rejected").map((r) => r.version_id);
      if (freed.length) setScoring((s) => new Set([...s].filter((id) => !freed.includes(id))));
      const failed = out.filter((o) => o.status === "rejected").length;
      toast(failed ? { text: t("{n} of {m} runs could not be scored. Try again.", { n: formatInt(failed), m: formatInt(rs.length) }), tone: "bad" } : { text: t("Scoring {n} runs.", { n: formatInt(rs.length) }), tone: "good" });
      refresh();
    },
  };

  const confirmPull = async () => {
    if (pullBusy.current) return;
    pullBusy.current = true;
    const rs = pulling ?? [];
    setPulling(null);
    try {
      const res = await startObjects([...new Set(rs.map((r) => r.module))]);
      toast({ text: res.skipped.length ? t("{n} objects queued to pull, {m} already running.", { n: formatInt(res.queued.length), m: formatInt(res.skipped.length) }) : t("{n} objects queued to pull.", { n: formatInt(res.queued.length) }), tone: "good" });
      refresh();
    } catch (err) {
      toast({ text: errorSentence(err, t("The pull could not start. Try again.")), tone: "bad" });
    } finally {
      pullBusy.current = false;
    }
  };

  const card = (r: PortfolioRow) => (
    <StoryCard key={r.version_id} row={r} act={act} finding={top.get(r.module)} evidence={count.get(r.module) ?? 0} onEvidence={() => { const f = top.get(r.module); if (f) sheets.open({ kind: "evidence", id: f.id }); }} />
  );

  return (
    <main className="nx-fd" data-testid="home">
      <Greeting name={session.name} needs={needs.length} running={rows.filter(runningNow).length} onCompare={() => sheets.open({ kind: "compare", id: "" })} onObjects={() => sheets.open({ kind: "objects", id: "" })} />
      {feed.isError ? <ErrorState error={feed.error} fallback={t("Home could not be read. Check that the API is reachable, then retry.")} onRetry={() => void feed.refetch()} />
        : feed.isLoading ? <div className="nx-fd-feed" aria-live="polite">{[0, 1, 2].map((i) => <StoryCardSkeleton key={i} />)}</div>
        : rows.length === 0 && systems.length > 0 ? (
          <EmptyState heading={t("No run yet.")} action={<V2Link className="nx-btn nx-btn-primary" href={`/s/${systems[0].id}`}>{t("Run your first pull")}</V2Link>}>
            {t("A system is connected. Pull its objects to see their quality here.")}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState heading={t("Nothing to show yet.")} action={<><Button variant="primary" onClick={() => sheets.open({ kind: "connect", id: "" })}>{t("Connect a system")}</Button> <V2Link className="nx-btn nx-btn-quiet" href="/portfolio?fixture=1">{t("See the sample")}</V2Link></>}>
            {t("Connect a system and run the first analysis.")}
          </EmptyState>
        ) : (
          <>
            <CapNotice page={feed.data} onAll={() => setAll(true)} loading={all && feed.isFetching} />
            <div className="nx-fd-feed">{needs.map(card)}</div>
            <QuietRow rows={quiet} sysName={sysName} />
          </>
        )}
      <Confirm open={!!pulling} title={t("Pull {n} objects now?", { n: formatInt(new Set((pulling ?? []).map((r) => r.module)).size) })} consequence={t("Meridian reads {n} objects from their systems again and scores the new runs. Nothing is written to the systems.", { n: formatInt(new Set((pulling ?? []).map((r) => r.module)).size) })} confirmLabel={t("Pull now")} onConfirm={() => void confirmPull()} onCancel={() => setPulling(null)} />
      <UploadPanel open={!!uploadFor} expected={uploadFor ?? []} onClose={() => setUploadFor(null)} onDone={() => { setUploadFor(null); refresh(); }} />
    </main>
  );
}
