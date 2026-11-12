"use client";

import { useEffect, useRef, useState } from "react";
import { streamRunEvents, type RunEvent } from "@/lib/api/v2/run-ops";
import { Coded, EmptyFrame, ErrorFrame } from "../parts";
import { t as tr } from "@/lib/v2/i18n";

type Row = RunEvent & { at: number };

/** Run states after which no more events come: listening to such a run only opens a stream that closes at once. */
const SETTLED = new Set(["complete", "agents_complete", "agents_failed", "failed", "cancelled"]);

const EVENT_WORD = {
  get complete() { return tr("Run finished"); },
  get error() { return tr("Run failed"); },
  get cancelled() { return tr("Run cancelled"); },
} as Record<string, string>;

const plain = (type: string): string => type.replace(/[_-]+/g, " ");

/** The payload as short "name value" pairs; a plain string stays as it is. */
function summary(data: unknown): string {
  if (data == null || data === "") return "";
  if (typeof data !== "object") return String(data);
  return Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${plain(k)} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/**
 * What a run reports while it works. The stream carries only what happens while it is open (nothing is replayed), so the
 * panel is a live log: it starts by itself on a run that is still going, and Listen or Stop controls it otherwise.
 */
export function RunEvents({ runId, status }: { runId: string; status?: string | null }) {
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
    stop.current = streamRunEvents(
      runId,
      (e) => setRows((r) => [...r, { ...e, at: Date.now() }]),
      (err) => {
        stop.current = null;
        setListening(false);
        if (err) setFailed(true);
      },
    );
  };

  // A run that is still going is listened to from the start; the stream is closed when the screen goes.
  const live = !!status && !SETTLED.has(status);
  useEffect(() => {
    setRows([]);
    if (live) listen();
    return () => {
      stop.current?.();
      stop.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, live]);

  return (
    <section className="m2-sec" aria-label={tr("Run events")} data-testid="run-events">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Run events")}</h2>
        <span className="m2-sub">{tr("What the run reports while it works. Events are live only: those from before you started listening are not kept.")}</span>
        <span className="m2-cta">
          <button type="button" className="m2-btn" onClick={listening ? close : listen} data-testid="run-events-toggle">
            {listening ? tr("Stop listening") : tr("Listen for events")}
          </button>
        </span>
      </div>
      {failed ? <ErrorFrame onRetry={listen}>{tr("The event stream could not be read.")}</ErrorFrame> : null}
      {rows.length === 0 ? (
        failed ? null : (
          <EmptyFrame>{listening ? tr("Listening. Nothing has been reported yet.") : tr("Not listening. Choose Listen for events to follow this run as it works.")}</EmptyFrame>
        )
      ) : (
        <ol className="m2-frame" data-testid="run-events-list" aria-live="polite">
          {rows.map((r, i) => (
            <li key={i}>
              <Coded code={r.type} text={EVENT_WORD[r.type] ?? plain(r.type)} />
              {summary(r.data) ? <span className="m2-sub"> {summary(r.data)}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
