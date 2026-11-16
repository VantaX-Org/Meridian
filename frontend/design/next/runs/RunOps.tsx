"use client";

/**
 * Run operations on the run detail: name the run, re-run the agents, follow its live events, and download every
 * object's summary. PATCH /versions/{id}, POST /versions/{id}/run-agents, GET /events/{id}, GET /objects/export.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Code, ErrorState, useToast } from "../kit";
import { exportObjects } from "@/lib/api/v2/object-records";
import { renameRun, rerunAgents, streamRunEvents, type RunEvent } from "@/lib/api/v2/run-ops";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import "./runs.css";

/** Run states after which no more events come. */
const SETTLED = new Set(["complete", "agents_complete", "agents_failed", "failed", "cancelled"]);
/** The agents can run again only on a finished run (the route answers 409 otherwise). */
const AGENTS_READY = new Set(["complete", "agents_complete", "agents_failed"]);

const plain = (type: string): string => type.replace(/[_-]+/g, " ");
const eventWord = (type: string): string =>
  type === "complete" ? t("Run finished") : type === "error" ? t("Run failed") : type === "cancelled" ? t("Run cancelled") : plain(type);

/** The payload as short "name value" pairs; a plain string stays as it is. */
export function eventSummary(data: unknown): string {
  if (data == null || data === "") return "";
  if (typeof data !== "object") return String(data);
  return Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${plain(k)} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

export function RunOps({ id, label, status }: { id: string; label: string | null; status: string }) {
  const can = useV2Session().can;
  const canChange = can("analyse");
  const canExport = can("export");
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? label ?? "";
  const changed = value.trim() !== (label ?? "");

  const act = async (what: string, job: () => Promise<{ text: string }>, fail: string) => {
    setBusy(what);
    try {
      const r = await job();
      toast({ text: r.text, tone: "good" });
      for (const k of ["v2", "next"]) void qc.invalidateQueries({ queryKey: [k] });
    } catch {
      toast({ text: fail, tone: "bad" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="nx-card" aria-label={t("Run actions")} data-testid="run-ops">
      <h3 className="nx-rn-h3">{t("Run actions")}</h3>
      <form
        className="nx-rn-pager"
        data-testid="run-rename"
        onSubmit={(e) => {
          e.preventDefault();
          const next = value.trim();
          void act("rename", async () => {
            const r = await renameRun(id, next);
            setDraft(null);
            return { text: r.label ? t("Run named {name}", { name: r.label }) : t("Run name cleared") };
          }, t("The run could not be renamed."));
        }}
      >
        <label className="nx-field">
          <span className="nx-field-label">{t("Run name")}</span>
          <input className="nx-input" placeholder={t("Name this run")} maxLength={200} value={value} disabled={!canChange || busy !== null} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <Button type="submit" disabled={!canChange || busy !== null || !changed}>{t("Save name")}</Button>
      </form>
      <p className="nx-rn-pager">
        <Button
          disabled={!canChange || busy !== null || !AGENTS_READY.has(status)}
          reason={!AGENTS_READY.has(status) ? t("The agents can run again once the run has finished") : undefined}
          loading={busy === "agents"}
          onClick={() => void act("agents", async () => { await rerunAgents(id); return { text: t("Agents started. The agents are reading this run's findings again.") }; }, t("The agents could not be started."))}
        >
          {t("Re-run agents")}
        </Button>
        {canExport ? (
          <Button loading={busy === "export"} disabled={busy !== null} onClick={() => void act("export", async () => { await exportObjects(id, "xlsx"); return { text: t("Every object's summary is downloaded.") }; }, t("The file could not be downloaded. Try again."))}>
            {t("Download every object's summary")}
          </Button>
        ) : null}
      </p>
      {!canChange ? <p className="nx-rn-sub">{t("Pinning, archiving, restoring, renaming and re-running agents need the analyse permission.")}</p> : null}
      {!canExport ? <p className="nx-rn-sub">{t("Downloading needs the export permission.")}</p> : null}
      <RunEventsPanel id={id} status={status} />
    </section>
  );
}

type Row = RunEvent & { at: number };

/** A live log: the stream carries only what happens while it is open, so it starts by itself on a run still going. */
function RunEventsPanel({ id, status }: { id: string; status: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  const close = () => {
    stop.current?.();
    stop.current = null;
    setListening(false);
  };
  const listen = () => {
    stop.current?.();
    setFailed(false);
    setListening(true);
    stop.current = streamRunEvents(id, (e) => setRows((r) => [...r, { ...e, at: Date.now() }]), (err) => {
      stop.current = null;
      setListening(false);
      if (err) setFailed(true);
    });
  };

  const live = !SETTLED.has(status);
  useEffect(() => {
    setRows([]);
    if (live) listen();
    return () => { stop.current?.(); stop.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, live]);

  return (
    <div data-testid="run-events">
      <h3 className="nx-rn-h3">{t("Run events")}</h3>
      <p className="nx-rn-sub">{t("What the run reports while it works. Events are live only: those from before you started listening are not kept.")}</p>
      <p className="nx-rn-pager">
        <Button onClick={listening ? close : listen} data-testid="run-events-toggle">{listening ? t("Stop listening") : t("Listen for events")}</Button>
      </p>
      {failed ? <ErrorState sentence={t("The event stream could not be read.")} onRetry={listen} /> : null}
      {rows.length === 0 ? (
        failed ? null : <p className="nx-rn-note">{listening ? t("Listening. Nothing has been reported yet.") : t("Not listening. Choose Listen for events to follow this run as it works.")}</p>
      ) : (
        <ol className="nx-rn-sub" data-testid="run-events-list" aria-live="polite">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`}>
              <Code code={r.type} text={eventWord(r.type)} /> {eventSummary(r.data)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
