"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { extractModules, getConfigSnapshot, healthCheck, listSystemModules, syncConfig } from "@/lib/api/v2/connectivity";
import { useFixture } from "@/lib/api/v2/fixture";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { Confirm } from "../admin/kit";
import { Dash, EmptyFrame, ErrorFrame, Mono, SapCode, Skeleton } from "../parts";
import { ScrollFrame } from "../screens/object/ScrollFrame";
import { TableExport } from "../TableExport";
import { ResultFrame, useOutcome } from "./shared";

const MAX_ROWS = 20;

/** One pulled configuration table: its rows, with the columns the pull itself returned. */
function SnapshotRows({ data }: { data: unknown }) {
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]).filter((r) => r && typeof r === "object") : [];
  if (rows.length === 0) return <Dash />;
  const cols = Object.keys(rows[0]);
  return (
    <ScrollFrame label={t("Rows of the pulled table, scrollable")}>
      <TableExport>
        <table className="m2-tbl">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} scope="col"><Mono>{c}</Mono></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c}>{String(r[c] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableExport>
      {rows.length > MAX_ROWS ? <p className="m2-prov">{t("The first {shown} of {total} rows.", { shown: MAX_ROWS, total: rows.length })}</p> : null}
    </ScrollFrame>
  );
}

/** The configuration last pulled for one module, as the API stored it. */
function PulledConfig({ systemId, module }: { systemId: string; module: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["v2", "connectivity", "config", fixture, systemId, module], queryFn: () => getConfigSnapshot(systemId, module), staleTime: 30_000 });
  if (q.isLoading) return <Skeleton width="100%" height={80} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The pulled configuration could not be read.")}</ErrorFrame>;
  const tables = q.data?.tables ?? [];
  if (tables.length === 0) return <EmptyFrame>{t("No configuration has been pulled for this module yet.")}</EmptyFrame>;
  return (
    <div data-testid="pulled-config">
      {tables.map((tb) => (
        <section key={tb.table} aria-label={t("Table {table}", { table: tb.table })}>
          <h4 className="m2-h3"><SapCode table={tb.table} /></h4>
          <p className="m2-prov">
            {t("{records} records, source {source}, pulled {when}", {
              records: int(tb.record_count ?? 0),
              source: tb.source ? labelText(tb.source) : "—",
              when: tb.synced_at ? formatDate(tb.synced_at, "datetime") : "—",
            })}
          </p>
          <SnapshotRows data={tb.data} />
        </section>
      ))}
    </div>
  );
}

type Ask = "config" | "extract";

/**
 * A system's modules and the connectivity actions on them. Pulling configuration and extracting read from the real
 * system, so each waits behind a confirmation and shows that it is running; nothing here edits a secret.
 */
export function ConnectivitySection({ systemId, canSync }: { systemId: string; canSync: boolean }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const { outcome, pending, run } = useOutcome();
  const [picked, setPicked] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: ["v2", "connectivity", "modules", fixture, systemId], queryFn: () => listSystemModules(systemId), staleTime: 15_000 });
  const mods = q.data ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["v2"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const toggle = (m: string) => setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));
  const names = picked.map((m) => moduleText(m)).join(", ");

  const check = () =>
    void run("health", async () => {
      const r = await healthCheck(systemId);
      refresh();
      return { tone: "ok", title: t("Health check queued"), detail: t("The result shows under Health once the job finishes."), job: r.job_id };
    });
  const confirmAsk = () => {
    const what = ask;
    if (!what) return;
    void run(what, async () => {
      const r = what === "config" ? await syncConfig(systemId, picked) : await extractModules(systemId, picked);
      refresh();
      setAsk(null);
      return what === "config"
        ? { tone: "ok", title: t("Configuration pull queued"), detail: t("It reads the configuration of {modules} and stores it. No transactional data is read.", { modules: names }), job: r.job_id }
        : { tone: "ok", title: t("Extraction queued"), detail: t("Data and configuration of {modules} are being read.", { modules: names }), job: r.job_id };
    }).finally(() => setAsk(null));
  };

  return (
    <section style={{ marginTop: "var(--m2-s4)" }} data-testid="connectivity" aria-label={t("Modules and connectivity")}>
      <h3 className="m2-h3">{t("Modules")}</h3>
      {q.isLoading ? (
        <Skeleton width="100%" height={100} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The modules of this system could not be read.")}</ErrorFrame>
      ) : mods.length === 0 ? (
        <EmptyFrame>{t("This system type has no modules to read.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Modules of the system, scrollable")}>
          <TableExport>
            <table className="m2-tbl" data-testid="connectivity-modules">
              <thead>
                <tr>
                  <th scope="col">{t("Pick")}</th>
                  <th scope="col">{t("Module")}</th>
                  <th scope="col">{t("Last read")}</th>
                  <th scope="col">{t("Rows")}</th>
                  <th scope="col">{t("Configuration")}</th>
                  <th scope="col">{t("Notes")}</th>
                </tr>
              </thead>
              <tbody>
                {mods.map((m) => (
                  <tr key={m.module}>
                    <td data-label={t("Pick")}>
                      <input type="checkbox" aria-label={t("Pick {module}", { module: moduleText(m.module) })} checked={picked.includes(m.module)} onChange={() => toggle(m.module)} />
                    </td>
                    <th scope="row">
                      {moduleText(m.module)} <Mono>{m.module}</Mono>
                    </th>
                    <td data-label={t("Last read")}>
                      {m.last_synced_at ? `${formatDate(m.last_synced_at, "datetime")}${m.last_sync_status ? `, ${labelText(m.last_sync_status)}` : ""}` : t("Never")}
                    </td>
                    <td data-label={t("Rows")} className="m2-num">{int(m.row_count)}</td>
                    <td data-label={t("Configuration")}>
                      {m.config_synced ? (
                        <button type="button" className="m2-btn" aria-pressed={viewing === m.module} onClick={() => setViewing(viewing === m.module ? null : m.module)}>
                          {viewing === m.module ? t("Hide configuration of {module}", { module: moduleText(m.module) }) : t("View configuration of {module}", { module: moduleText(m.module) })}
                        </button>
                      ) : (
                        t("Not pulled")
                      )}
                    </td>
                    <td data-label={t("Notes")}>
                      {m.preview_sources.length ? (
                        <span data-testid={`preview-${m.module}`}>
                          {t("Preview: the names of {sources} are not yet verified against SAP.", { sources: m.preview_sources.map((p) => p.source).join(", ") })}
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableExport>
        </ScrollFrame>
      )}

      <div className="m2-acts">
        <button type="button" className="m2-btn" disabled={!canSync || pending !== null} onClick={check}>
          {pending === "health" ? t("Queueing…") : t("Run a health check")}
        </button>
        <button type="button" className="m2-btn" disabled={!canSync || picked.length === 0 || pending !== null} onClick={() => setAsk("config")}>
          {pending === "config" ? t("Pulling…") : t("Pull configuration")}
        </button>
        <button type="button" className="m2-btn" disabled={!canSync || picked.length === 0 || pending !== null} onClick={() => setAsk("extract")}>
          {pending === "extract" ? t("Extracting…") : t("Run extract")}
        </button>
      </div>
      {picked.length === 0 && canSync ? <p className="m2-prov">{t("Pick at least one module to pull configuration or run an extract.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {viewing ? <PulledConfig systemId={systemId} module={viewing} /> : null}

      {ask ? (
        <Confirm
          title={ask === "config" ? t("Pull configuration of {modules}", { modules: names }) : t("Run an extract of {modules}", { modules: names })}
          body={
            ask === "config"
              ? t("This connects to the system and reads the configuration tables of the picked modules. No transactional data is read.")
              : t("This connects to the system and reads data and configuration of the picked modules. A large extract can take a long time and load the system.")
          }
          confirm={ask === "config" ? t("Pull configuration") : t("Run extract")}
          pending={pending === ask}
          onCancel={() => setAsk(null)}
          onConfirm={confirmAsk}
        />
      ) : null}
    </section>
  );
}
