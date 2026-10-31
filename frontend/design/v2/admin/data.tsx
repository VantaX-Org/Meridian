"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditEntry, AuditListParams } from "@/lib/api/audit";
import type { FieldMapping } from "@/lib/api/field-mappings";
import * as api from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { apiErrorMessage } from "@/lib/error";
import { failureText } from "@/lib/v2/errors";
import { formatDate } from "@/lib/format";
import { auditSentence } from "@/lib/v2/audit-sentence";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useAudit, useMappings, useReference, useUsers } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { type GridColumn } from "../Grid";
import { Dash, EmptyFrame, ErrorFrame, Mono } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Confirm, Fld, Loaded, NeedsPermission, Note, Pager, StatusWord, since, useCan } from "./kit";
import { ToolGrid } from "../GridTools";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";

/* ── Field mappings ── */

const isDefault = (m: FieldMapping, key: "customer_field" | "customer_label"): boolean => !m.is_mapped && m[key] === (key === "customer_field" ? m.standard_field : m.standard_label);
export const shownValue = (m: FieldMapping, key: "customer_field" | "customer_label"): string => (isDefault(m, key) ? "" : (m[key] ?? ""));

const MAP_COLUMNS: GridColumn<FieldMapping>[] = [
  { id: "object", get header() { return t("Object"); }, width: 170, cell: (m) => moduleText(m.module) },
  {
    id: "field",
    get header() { return t("Standard field"); },
    width: 280,
    pin: true,
    locked: true,
    cell: (m) => (
      <span>
        <Mono>{m.standard_field}</Mono> <span className="m2-meta">{m.standard_label}</span>
      </span>
    ),
  },
  { id: "type", get header() { return t("Type"); }, width: 90, cell: (m) => <Mono>{m.data_type}</Mono> },
  { id: "column", get header() { return t("Customer column"); }, width: 190, cell: (m) => (shownValue(m, "customer_field") ? <Mono>{shownValue(m, "customer_field")}</Mono> : <Dash why={t("Not mapped: the standard column is read")} />) },
  { id: "label", get header() { return t("Customer label"); }, width: 170, cell: (m) => shownValue(m, "customer_label") || <Dash /> },
  { id: "notes", get header() { return t("Notes"); }, width: 200, defaultHidden: true, cell: (m) => m.notes ?? <Dash /> },
  { id: "state", get header() { return t("State"); }, width: 120, cell: (m) => (m.is_mapped ? <StatusWord tone="go">{t("Mapped")}</StatusWord> : <StatusWord tone="neutral">{t("Not mapped")}</StatusWord>) },
];

/** Admin › Field mappings: which column in the customer's files holds each standard SAP field. */
export function MappingsSection() {
  const can = useCan();
  const qc = useQueryClient();
  const { openItem, open } = useOpenItem();
  const [search, setSearch] = useState("");
  const [object, setObject] = useState("");
  const [resetting, setResetting] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const write = can("manage_field_mappings");
  const all = useMappings({});
  const q = useMappings({ module: object || undefined, search: search.trim() || undefined });
  const objects = useMemo(() => [...new Set((all.data?.mappings ?? []).map((m) => m.module))].sort(), [all.data]);
  const rows = q.data?.mappings ?? [];
  const mapped = rows.filter((m) => m.is_mapped).length;
  const custom = rows.filter((m) => m.customer_field || m.customer_label || m.notes).length;
  const selfService = q.data?.self_service_enabled ?? true;
  return (
    <AdminPage
      title={t("Field mappings")}
      lead={t("{value}Name the column in your files that holds each standard SAP field, then save the row. Open a row to edit it.", { value: rows.length ? t("{mapped} of {rowsCount} standard fields are mapped. ", { mapped, rowsCount: rows.length }) : "" })}
      actions={
        write && selfService ? (
          <button type="button" className="m2-btn" disabled={custom === 0 || pending !== null} onClick={() => setResetting(true)}>
            {object ? t("Reset {object} to defaults", { object: moduleText(object) }) : t("Reset all to defaults")}
          </button>
        ) : undefined
      }
    >
      {!write ? <Note>{t("Read only for your role. Changing mappings needs the manage field mappings permission.")}</Note> : !selfService ? <Note tone="warn">{t("Field mapping self-service is not part of this licence, so mappings are read only.")}</Note> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Block>
        <ToolGrid<FieldMapping>
          toolsTitle={t("Field mappings")}
          id="admin-mappings"
          ariaLabel={t("Field mappings")}
          columns={MAP_COLUMNS}
          rows={rows}
          rowId={(m) => m.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The mappings could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(q.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{t("No field matches. Clear the search or choose another object.")}</EmptyFrame>}
          toolbar={
            <div className="m2-fbar" role="search" aria-label={t("Filter mappings")} style={{ marginBottom: 0 }}>
              <Fld label={t("Search")}>
                <input type="search" value={search} placeholder={t("Field, label or column")} onChange={(e) => setSearch(e.target.value)} />
              </Fld>
              <Fld label={t("Object")}>
                <select value={object} onChange={(e) => setObject(e.target.value)}>
                  <option value="">{t("All objects")}</option>
                  {objects.map((o) => (
                    <option key={o} value={o}>
                      {moduleText(o)}
                    </option>
                  ))}
                </select>
              </Fld>
            </div>
          }
          onOpen={(m) => openItem({ kind: "mapping", id: m.id })}
          openRowId={open?.kind === "mapping" ? open.id : null}
        />
      </Block>
      {resetting ? (
        <Confirm
          title={object ? t("Reset {object} to defaults", { object: moduleText(object) }) : t("Reset all mappings to defaults")}
          body={t("{custom} {custom, plural, one {field loses its} other {fields lose their}} customer column, label and note. The standard SAP columns are read again.", { custom })}
          confirm={t("Reset to defaults")}
          danger
          pending={pending === "reset"}
          onCancel={() => setResetting(false)}
          onConfirm={() =>
            void run("reset", async () => {
              const r = await api.resetFieldMappings(object || undefined);
              await refreshAdmin(qc, "mappings");
              setResetting(false);
              return { tone: "ok", title: t("{reset_count} {reset_count, plural, one {mapping} other {mappings}} reset to defaults", { reset_count: r.reset_count }) };
            })
          }
        />
      ) : null}
    </AdminPage>
  );
}

/* ── Reference data ── */

const KIND_LABEL: Record<string, string> = { get "postal-codes"() { return t("Postal codes"); }, get postal_codes() { return t("Postal codes"); }, get postal() { return t("Postal codes"); }, get bic() { return t("Bank codes (SWIFT BIC)"); }, get bics() { return t("Bank codes (SWIFT BIC)"); } };
const kindLabel = (k: string): string => KIND_LABEL[k] ?? labelText(k);

/** Admin › Reference data: the postal code and bank code lists held per system. Uploading replaces a system's list. */
export function ReferenceSection() {
  const can = useCan();
  const qc = useQueryClient();
  const systems = useSystemsExtended();
  const [picked, setPicked] = useState("");
  const id = picked || systems.data?.[0]?.id || "";
  const lists = useReference(id);
  const write = can("manage_systems");
  const [kind, setKind] = useState<"postal-codes" | "bic">("postal-codes");
  const [csv, setCsv] = useState("");
  const { outcome, pending, run } = useOutcome();
  const system = systems.data?.find((s) => s.id === id);
  return (
    <AdminPage title={t("Reference data")} lead={t("Official postal code and bank code lists, per system, that address and bank rules compare against. Until a list is loaded those rules check the format only.")}>
      <div className="m2-fbar">
        <Fld label={t("System")}>
          <select value={id} onChange={(e) => setPicked(e.target.value)}>
            {(systems.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Fld>
      </div>
      {systems.isSuccess && (systems.data ?? []).length === 0 ? (
        <EmptyFrame>{t("Reference lists belong to a system. Connect a system first, from the landscape.")}</EmptyFrame>
      ) : (
        <>
          <Loaded q={lists} what={t("The reference lists")} rows={2}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyFrame>{t("No reference data is loaded for {name}. Upload a list below.", { name: system?.name ?? t("this system") })}</EmptyFrame>
              ) : (
                <div className="m2-frame" tabIndex={0}>
                  <table className="m2-tbl" aria-label={t("Reference lists")}>
                    <thead>
                      <tr>
                        <th scope="col">{t("List")}</th>
                        <th scope="col" className="m2-r">{t("Records")}</th>
                        <th scope="col">{t("Countries")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.kind}>
                          <th scope="row">{kindLabel(r.kind)}</th>
                          <td className="m2-r">{int(r.records)}</td>
                          <td>{r.countries.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loaded>
          {write ? (
            <Block title={t("Upload or replace a list")} hint={t("Postal codes: a CSV with the columns country, postcode (the SAP country key). Bank codes: the licensed SWIFT BIC directory as CSV, BIC in the first column. An upload replaces the system's current list.")}>
              <div className="m2-fgrid">
                <Fld label={t("List")}>
                  <select value={kind} onChange={(e) => setKind(e.target.value as "postal-codes" | "bic")}>
                    <option value="postal-codes">{t("Postal codes")}</option>
                    <option value="bic">{t("Bank codes (SWIFT BIC)")}</option>
                  </select>
                </Fld>
                <Fld label={t("File")}>
                  <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void e.target.files?.[0]?.text().then(setCsv)} />
                </Fld>
                <Fld label="CSV" wide hint={csv ? t("{filterCount} lines ready", { filterCount: csv.split(/\r?\n/).filter(Boolean).length }) : t("Choose a file, or paste the lines here.")}>
                  <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
                </Fld>
              </div>
              {outcome ? <ResultFrame outcome={outcome} /> : null}
              <div className="m2-adm-acts">
                <button
                  type="button"
                  className="m2-btn"
                  disabled={!csv.trim() || !id || pending !== null}
                  onClick={() =>
                    void run("upload", async () => {
                      const r = await api.uploadReference(id, kind, csv);
                      await refreshAdmin(qc, "reference");
                      setCsv("");
                      return { tone: "ok", title: t("{kindLabel} loaded", { kindLabel: kindLabel(r.kind) }), detail: t("{records} records{value}.", { records: int(r.records), value: r.countries.length ? t(" for {countries}", { countries: r.countries.join(", ") }) : "" }) };
                    })
                  }
                >
                  {pending === "upload" ? t("Uploading…") : t("Upload the list")}
                </button>
              </div>
            </Block>
          ) : (
            <NeedsPermission what={t("Uploading reference data")} permission="manage_systems" />
          )}
        </>
      )}
    </AdminPage>
  );
}

/* ── Audit ── */

const PAGE = 25;

const AUDIT_COLUMNS = (who: (e: AuditEntry) => string): GridColumn<AuditEntry>[] => [
  { id: "when", header: t("When"), width: 150, pin: true, locked: true, cell: (e) => <time dateTime={e.created_at}>{formatDate(e.created_at, "datetime")}</time> },
  { id: "who", header: t("Who"), width: 180, cell: (e) => who(e) },
  { id: "what", header: t("What happened"), width: 380, cell: (e) => auditSentence(e, who(e)) },
  { id: "action", header: t("Action"), width: 150, cell: (e) => <Mono>{e.action}</Mono> },
  { id: "object", header: t("Target"), width: 140, cell: (e) => (e.entity_id ? <Mono>{e.entity_id}</Mono> : <Dash />) },
  { id: "status", header: t("Result"), width: 110, cell: (e) => (e.status_code >= 400 ? <StatusWord tone="no-go">{t("Refused {status_code}", { status_code: e.status_code })}</StatusWord> : <StatusWord tone="go">{t("Done")}</StatusWord>) },
];

function AiAudit() {
  const fixture = useFixture();
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["v2", "admin", fixture, "audit", "ai", page], queryFn: () => api.getAiAudit({ limit: 10, offset: page * 10 }), staleTime: 15_000, retry: false });
  return (
    <Block title={t("AI calls")} hint={t("Every call to the language model: which service, how long, and whether a deterministic rule answered first. Prompts and records are never stored here.")}>
      <Loaded q={q} what={t("The AI audit")} rows={3}>
        {(d) =>
          d.entries.length === 0 ? (
            <EmptyFrame>{t("No AI call has been made. The product answers from its rules first and calls a model only for wording.")}</EmptyFrame>
          ) : (
            <>
              <div className="m2-frame" tabIndex={0}>
                <table className="m2-tbl" aria-label={t("AI calls")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("When")}</th>
                      <th scope="col">{t("Service")}</th>
                      <th scope="col">{t("Model")}</th>
                      <th scope="col" className="m2-r">{t("Tokens")}</th>
                      <th scope="col" className="m2-r">{t("Latency")}</th>
                      <th scope="col">{t("Result")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.called_at, "datetime")}</td>
                        <td>{labelText(e.service_name)}</td>
                        <td>{e.model_version ?? "—"}</td>
                        <td className="m2-r">{e.token_count == null ? "—" : int(e.token_count)}</td>
                        <td className="m2-r">{e.latency_ms == null ? "—" : t("{latency_ms} ms", { latency_ms: int(e.latency_ms) })}</td>
                        <td>{e.deterministic_hit ? <StatusWord tone="go">{t("Rule answered")}</StatusWord> : e.success ? <StatusWord tone="go">{t("Model answered")}</StatusWord> : <StatusWord tone="no-go">{e.skip_reason ?? t("Failed")}</StatusWord>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={page * 10} limit={10} total={d.total} onPage={(o) => setPage(o / 10)} />
            </>
          )
        }
      </Loaded>
    </Block>
  );
}

/** Admin › Audit log: a permanent record of who changed what, filterable and exportable. */
export function AuditSection() {
  const can = useCan();
  const { openItem, open } = useOpenItem();
  const allowed = can("view_audit") || can("manage_users");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [object, setObject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The user list needs user admin; without it the Who filter offers everyone the log has shown so far.
  const users = useUsers({}, can("manage_users"));
  const seen = useRef(new Map<string, string>());
  const filters: AuditListParams = useMemo(
    () => ({ actor_user_id: actor || undefined, action: action.trim() || undefined, entity_type: object || undefined, since: from || undefined, until: to || undefined }),
    [actor, action, object, from, to],
  );
  const q = useAudit({ ...filters, limit: PAGE, offset }, allowed);
  const fixture = useFixture();
  const summary = useQuery({ queryKey: ["v2", "admin", fixture, "audit", "summary"], queryFn: api.getAuditSummary, staleTime: 60_000, retry: false, enabled: allowed });
  const kinds = useMemo(() => [...new Set((summary.data?.summary ?? []).map((r) => r.entity_type).filter((x): x is string => !!x))].sort(), [summary.data]);
  const who = (e: AuditEntry) => (e.actor_email ? (users.data?.users.find((u) => u.id === e.actor_user_id)?.name ?? e.actor_email) : t("The system"));
  const columns = useMemo(() => AUDIT_COLUMNS(who), [users.data]); // eslint-disable-line react-hooks/exhaustive-deps
  for (const e of q.data?.entries ?? []) if (e.actor_user_id && e.actor_email) seen.current.set(e.actor_user_id, e.actor_email);
  const actors = users.data ? users.data.users.map((u) => ({ id: u.id, name: u.name })) : [...seen.current].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  if (!allowed) return <AdminPage title={t("Audit log")}><NeedsPermission what={t("Reading the audit log")} permission="view_audit" /></AdminPage>;
  const filtered = Object.values(filters).some(Boolean);
  const badRange = !!from && !!to && to < from;
  const reset = (fn: () => void) => (fn(), setOffset(0));
  const exportAs = async (format: "csv" | "xlsx") => {
    setExporting(format);
    setError(null);
    try {
      await api.exportAudit(format, filters);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setExporting(null);
    }
  };
  return (
    <AdminPage
      title={t("Audit log")}
      lead={t("{value}A permanent record of who changed what, every call to the language model, and every change to a user. Export it for an auditor.", { value: summary.data?.total != null ? t("{total} events recorded in the last 30 days. ", { total: int(summary.data.total) }) : "" })}
      actions={
        <>
          <button type="button" className="m2-btn" disabled={exporting !== null || badRange} onClick={() => void exportAs("csv")}>
            {exporting === "csv" ? t("Exporting…") : t("Export CSV")}
          </button>
          <button type="button" className="m2-btn" disabled={exporting !== null || badRange} onClick={() => void exportAs("xlsx")}>
            {exporting === "xlsx" ? t("Exporting…") : t("Export Excel")}
          </button>
        </>
      }
    >
      {error ? <ErrorFrame>{t("The export did not finish. {error}", { error })}</ErrorFrame> : null}
      <Block>
        <div className="m2-fbar" role="search" aria-label={t("Filter the audit log")}>
          <Fld label={t("Who")}>
            <select value={actor} onChange={(e) => reset(() => setActor(e.target.value))} data-testid="audit-who">
              <option value="">{t("Anyone")}</option>
              {actors.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Fld>
          <Fld label={t("Action contains")}>
            <input value={action} placeholder="user.invite" onChange={(e) => reset(() => setAction(e.target.value))} />
          </Fld>
          <Fld label={t("Object kind")}>
            <select value={object} onChange={(e) => reset(() => setObject(e.target.value))}>
              <option value="">{t("Any")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {labelText(k)}
                </option>
              ))}
            </select>
          </Fld>
          <Fld label={t("From")}>
            <input type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </Fld>
          <Fld label={t("To")} error={badRange ? t("Ends before it starts") : null}>
            <input type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} />
          </Fld>
          {filtered ? (
            <button type="button" className="m2-btn" onClick={() => reset(() => (setActor(""), setAction(""), setObject(""), setFrom(""), setTo("")))}>
              {t("Clear filters")}
            </button>
          ) : null}
        </div>
        <ToolGrid<AuditEntry>
          toolsTitle={t("Audit log")}
          id="admin-audit"
          ariaLabel={t("Audit log")}
          columns={columns}
          rows={q.data?.entries ?? []}
          rowId={(e) => e.id}
          loading={q.isPending}
          count={q.data?.total}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The audit log could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(q.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{filtered ? t("Nothing matches these filters. Widen the dates or pick someone else.") : t("No events recorded yet.")}</EmptyFrame>}
          onOpen={(e) => openItem({ kind: "audit", id: e.id })}
          openRowId={open?.kind === "audit" ? open.id : null}
          fixedColumns
        />
        {q.data ? <Pager offset={offset} limit={PAGE} total={q.data.total} onPage={setOffset} /> : null}
        <p className="m2-prov">{q.data?.entries[0]?.created_at ? t("Latest event {created_at}.", { created_at: since(q.data.entries[0].created_at) }) : ""}</p>
      </Block>
      <AiAudit />
    </AdminPage>
  );
}
