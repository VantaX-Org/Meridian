"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_WINDOWS, getMaintenance, putMaintenance, type MaintenanceWindow } from "@/lib/api/v2/maintenance";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Block, Fld, Loaded, StatusWord, useCan, useUnsaved } from "./kit";

/** A row as typed: the times are datetime-local strings in the browser's zone. */
type Draft = { title: string; start: string; end: string; detail: string };

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const draftOf = (w: MaintenanceWindow): Draft => ({ title: w.title, start: toLocal(w.starts_at), end: toLocal(w.ends_at), detail: w.detail ?? "" });

/** The first problem with a row, in the words the backend uses, or null. */
function problem(d: Draft): string | null {
  if (!d.title.trim()) return t("Give the window a title.");
  if (!d.start || !d.end) return t("Give a start and an end.");
  if (Date.parse(d.end) <= Date.parse(d.start)) return t("A maintenance window must end after it starts.");
  return null;
}

function state(w: MaintenanceWindow, now: number) {
  const s = Date.parse(w.starts_at), e = Date.parse(w.ends_at);
  if (e <= now) return <StatusWord tone="neutral">{t("Over")}</StatusWord>;
  if (s <= now) return <StatusWord tone="at-risk">{t("In progress")}</StatusWord>;
  return <StatusWord tone="neutral">{t("Scheduled")}</StatusWord>;
}

function Editor({ initial }: { initial: MaintenanceWindow[] }) {
  const qc = useQueryClient();
  const f = useFixture();
  const [rows, setRows] = useState<Draft[]>(() => initial.map(draftOf));
  const dirty = useUnsaved(rows);
  const { outcome, pending, run } = useOutcome("maintenance");
  const bad = rows.map(problem);
  const set = (i: number, p: Partial<Draft>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  return (
    <>
      {rows.length ? (
        <div className="m2-procs" role="group" aria-label={t("Maintenance windows")}>
          {rows.map((r, i) => (
            <fieldset key={i} className="m2-mwin">
              <div className="m2-fgrid">
                <Fld label={t("Title")} error={bad[i]}>
                  <input maxLength={120} aria-label={t("Title of window {n}", { n: i + 1 })} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
                </Fld>
                <Fld label={t("What users see")}>
                  <input maxLength={500} aria-label={t("Detail of window {n}", { n: i + 1 })} value={r.detail} placeholder={t("Optional")} onChange={(e) => set(i, { detail: e.target.value })} />
                </Fld>
                <Fld label={t("Starts")}>
                  <input type="datetime-local" aria-label={t("Start of window {n}", { n: i + 1 })} value={r.start} onChange={(e) => set(i, { start: e.target.value })} />
                </Fld>
                <Fld label={t("Ends")}>
                  <input type="datetime-local" aria-label={t("End of window {n}", { n: i + 1 })} value={r.end} onChange={(e) => set(i, { end: e.target.value })} />
                </Fld>
              </div>
              <div className="m2-adm-acts">
                <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => setRows(rows.filter((_, n) => n !== i))}>{t("Remove")}</button>
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className="m2-prov">{t("No maintenance is scheduled. The public status page shows none.")}</p>
      )}
      <p className="m2-prov">{t("Times are in your time zone, {zone}. They are stored in UTC.", { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn m2-ghost" disabled={rows.length >= MAX_WINDOWS} onClick={() => setRows([...rows, { title: "", start: "", end: "", detail: "" }])}>
          {t("Add a window")}
        </button>
        <button
          type="button"
          className="m2-btn"
          disabled={!dirty || bad.some(Boolean) || pending !== null}
          onClick={() =>
            void run("save", async () => {
              const saved = await putMaintenance(rows.map((r) => ({ title: r.title.trim(), starts_at: new Date(r.start).toISOString(), ends_at: new Date(r.end).toISOString(), detail: r.detail.trim() || null })));
              qc.setQueryData(["v2", "maintenance", f], saved);
              return { tone: "ok", title: t("Maintenance windows saved") };
            })
          }
        >
          {pending === "save" ? t("Saving…") : t("Save windows")}
        </button>
      </div>
    </>
  );
}

/**
 * Admin › Settings › Scheduled maintenance: the windows the public status page announces. Reading and changing them
 * both need manage_settings, as the route does.
 */
export function MaintenanceBlock() {
  const write = useCan()("manage_settings");
  const f = useFixture();
  const q = useQuery({ queryKey: ["v2", "maintenance", f], queryFn: getMaintenance, enabled: write, retry: false });
  const [now] = useState(() => Date.now());
  if (!write) return null;
  return (
    <Block id="maintenance" title={t("Scheduled maintenance")} hint={t("Windows announced on the public status page before they start, and shown as in progress while they run.")}>
      <Loaded q={q} what={t("The maintenance windows")} rows={2}>
        {(m) => (
          <>
            {m.windows.length ? (
              <ul className="m2-prov" aria-label={t("Saved windows")}>
                {m.windows.map((w) => (
                  <li key={w.id ?? w.starts_at}>
                    {state(w, now)} {w.title}: {formatDate(w.starts_at, "datetime")} {t("to")} {formatDate(w.ends_at, "datetime")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m2-meta" data-testid="maint-none">{t("No maintenance window is scheduled.")}</p>
            )}
            <Editor key={JSON.stringify(m.windows)} initial={m.windows} />
          </>
        )}
      </Loaded>
    </Block>
  );
}
