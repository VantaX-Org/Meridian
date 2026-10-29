"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuditEntry, AuditListParams } from "@/lib/api/audit";
import type { FieldMapping } from "@/lib/api/field-mappings";
import * as api from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { apiErrorMessage } from "@/lib/error";
import { failureText } from "@/lib/v2/errors";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
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

/* ── Field mappings ── */

const isDefault = (m: FieldMapping, key: "customer_field" | "customer_label"): boolean => !m.is_mapped && m[key] === (key === "customer_field" ? m.standard_field : m.standard_label);
export const shownValue = (m: FieldMapping, key: "customer_field" | "customer_label"): string => (isDefault(m, key) ? "" : (m[key] ?? ""));

const MAP_COLUMNS: GridColumn<FieldMapping>[] = [
  { id: "object", header: "Object", width: 170, cell: (m) => formatModuleName(m.module) },
  {
    id: "field",
    header: "Standard field",
    width: 280,
    pin: true,
    locked: true,
    cell: (m) => (
      <span>
        <Mono>{m.standard_field}</Mono> <span className="m2-meta">{m.standard_label}</span>
      </span>
    ),
  },
  { id: "type", header: "Type", width: 90, cell: (m) => <Mono>{m.data_type}</Mono> },
  { id: "column", header: "Customer column", width: 190, cell: (m) => (shownValue(m, "customer_field") ? <Mono>{shownValue(m, "customer_field")}</Mono> : <Dash why="Not mapped: the standard column is read" />) },
  { id: "label", header: "Customer label", width: 170, cell: (m) => shownValue(m, "customer_label") || <Dash /> },
  { id: "notes", header: "Notes", width: 200, defaultHidden: true, cell: (m) => m.notes ?? <Dash /> },
  { id: "state", header: "State", width: 120, cell: (m) => (m.is_mapped ? <StatusWord tone="go">Mapped</StatusWord> : <StatusWord tone="neutral">Not mapped</StatusWord>) },
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
      title="Field mappings"
      lead={`${rows.length ? `${mapped} of ${rows.length} standard fields are mapped. ` : ""}Name the column in your files that holds each standard SAP field, then save the row. Open a row to edit it.`}
      actions={
        write && selfService ? (
          <button type="button" className="m2-btn" disabled={custom === 0 || pending !== null} onClick={() => setResetting(true)}>
            {object ? `Reset ${formatModuleName(object)} to defaults` : "Reset all to defaults"}
          </button>
        ) : undefined
      }
    >
      {!write ? <Note>Read only for your role. Changing mappings needs the manage field mappings permission.</Note> : !selfService ? <Note tone="warn">Field mapping self-service is not part of this licence, so mappings are read only.</Note> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Block>
        <ToolGrid<FieldMapping>
          toolsTitle="Field mappings"
          id="admin-mappings"
          ariaLabel="Field mappings"
          columns={MAP_COLUMNS}
          rows={rows}
          rowId={(m) => m.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{`The mappings could not be read. ${apiErrorMessage(q.error)}`}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>No field matches. Clear the search or choose another object.</EmptyFrame>}
          toolbar={
            <div className="m2-fbar" role="search" aria-label="Filter mappings" style={{ marginBottom: 0 }}>
              <Fld label="Search">
                <input type="search" value={search} placeholder="Field, label or column" onChange={(e) => setSearch(e.target.value)} />
              </Fld>
              <Fld label="Object">
                <select value={object} onChange={(e) => setObject(e.target.value)}>
                  <option value="">All objects</option>
                  {objects.map((o) => (
                    <option key={o} value={o}>
                      {formatModuleName(o)}
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
          title={object ? `Reset ${formatModuleName(object)} to defaults` : "Reset all mappings to defaults"}
          body={`${custom} ${custom === 1 ? "field loses its" : "fields lose their"} customer column, label and note. The standard SAP columns are read again.`}
          confirm="Reset to defaults"
          danger
          pending={pending === "reset"}
          onCancel={() => setResetting(false)}
          onConfirm={() =>
            void run("reset", async () => {
              const r = await api.resetFieldMappings(object || undefined);
              await refreshAdmin(qc, "mappings");
              setResetting(false);
              return { tone: "ok", title: `${r.reset_count} ${r.reset_count === 1 ? "mapping" : "mappings"} reset to defaults` };
            })
          }
        />
      ) : null}
    </AdminPage>
  );
}

/* ── Reference data ── */

const KIND_LABEL: Record<string, string> = { "postal-codes": "Postal codes", postal_codes: "Postal codes", postal: "Postal codes", bic: "Bank codes (SWIFT BIC)", bics: "Bank codes (SWIFT BIC)" };
const kindLabel = (k: string): string => KIND_LABEL[k] ?? labelOf(k);

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
    <AdminPage title="Reference data" lead="Official postal code and bank code lists, per system, that address and bank rules compare against. Until a list is loaded those rules check the format only.">
      <div className="m2-fbar">
        <Fld label="System">
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
        <EmptyFrame>Reference lists belong to a system. Connect a system first, from the landscape.</EmptyFrame>
      ) : (
        <>
          <Loaded q={lists} what="The reference lists" rows={2}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyFrame>{`No reference data is loaded for ${system?.name ?? "this system"}. Upload a list below.`}</EmptyFrame>
              ) : (
                <div className="m2-frame" tabIndex={0}>
                  <table className="m2-tbl" aria-label="Reference lists">
                    <thead>
                      <tr>
                        <th scope="col">List</th>
                        <th scope="col" className="m2-r">Records</th>
                        <th scope="col">Countries</th>
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
            <Block title="Upload or replace a list" hint="Postal codes: a CSV with the columns country, postcode (the SAP country key). Bank codes: the licensed SWIFT BIC directory as CSV, BIC in the first column. An upload replaces the system's current list.">
              <div className="m2-fgrid">
                <Fld label="List">
                  <select value={kind} onChange={(e) => setKind(e.target.value as "postal-codes" | "bic")}>
                    <option value="postal-codes">Postal codes</option>
                    <option value="bic">Bank codes (SWIFT BIC)</option>
                  </select>
                </Fld>
                <Fld label="File">
                  <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void e.target.files?.[0]?.text().then(setCsv)} />
                </Fld>
                <Fld label="CSV" wide hint={csv ? `${csv.split(/\r?\n/).filter(Boolean).length} lines ready` : "Choose a file, or paste the lines here."}>
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
                      return { tone: "ok", title: `${kindLabel(r.kind)} loaded`, detail: `${int(r.records)} records${r.countries.length ? ` for ${r.countries.join(", ")}` : ""}.` };
                    })
                  }
                >
                  {pending === "upload" ? "Uploading…" : "Upload the list"}
                </button>
              </div>
            </Block>
          ) : (
            <NeedsPermission what="Uploading reference data" permission="manage_systems" />
          )}
        </>
      )}
    </AdminPage>
  );
}

/* ── Audit ── */

const PAGE = 25;

const AUDIT_COLUMNS = (who: (e: AuditEntry) => string): GridColumn<AuditEntry>[] => [
  { id: "when", header: "When", width: 150, pin: true, locked: true, cell: (e) => <time dateTime={e.created_at}>{formatDate(e.created_at, "datetime")}</time> },
  { id: "who", header: "Who", width: 180, cell: (e) => who(e) },
  { id: "what", header: "What happened", width: 380, cell: (e) => auditSentence(e) },
  { id: "action", header: "Action", width: 150, cell: (e) => <Mono>{e.action}</Mono> },
  { id: "object", header: "Object", width: 140, cell: (e) => (e.entity_id ? <Mono>{e.entity_id}</Mono> : <Dash />) },
  { id: "status", header: "Result", width: 110, cell: (e) => (e.status_code >= 400 ? <StatusWord tone="no-go">{`Refused ${e.status_code}`}</StatusWord> : <StatusWord tone="go">Done</StatusWord>) },
];

function AiAudit() {
  const fixture = useFixture();
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["v2", "admin", fixture, "audit", "ai", page], queryFn: () => api.getAiAudit({ limit: 10, offset: page * 10 }), staleTime: 15_000, retry: false });
  return (
    <Block title="AI calls" hint="Every call to the language model: which service, how long, and whether a deterministic rule answered first. Prompts and records are never stored here.">
      <Loaded q={q} what="The AI audit" rows={3}>
        {(d) =>
          d.entries.length === 0 ? (
            <EmptyFrame>No AI call has been made. The product answers from its rules first and calls a model only for wording.</EmptyFrame>
          ) : (
            <>
              <div className="m2-frame" tabIndex={0}>
                <table className="m2-tbl" aria-label="AI calls">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Service</th>
                      <th scope="col">Model</th>
                      <th scope="col" className="m2-r">Tokens</th>
                      <th scope="col" className="m2-r">Latency</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.called_at, "datetime")}</td>
                        <td>{labelOf(e.service_name)}</td>
                        <td>{e.model_version ?? "—"}</td>
                        <td className="m2-r">{e.token_count == null ? "—" : int(e.token_count)}</td>
                        <td className="m2-r">{e.latency_ms == null ? "—" : `${int(e.latency_ms)} ms`}</td>
                        <td>{e.deterministic_hit ? <StatusWord tone="go">Rule answered</StatusWord> : e.success ? <StatusWord tone="go">Model answered</StatusWord> : <StatusWord tone="no-go">{e.skip_reason ?? "Failed"}</StatusWord>}</td>
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
  // Filtering by actor needs the user list; an auditor without user admin gets no actor filter.
  const users = useUsers({}, can("manage_users"));
  const filters: AuditListParams = useMemo(
    () => ({ actor_user_id: actor || undefined, action: action.trim() || undefined, entity_type: object || undefined, since: from || undefined, until: to || undefined }),
    [actor, action, object, from, to],
  );
  const q = useAudit({ ...filters, limit: PAGE, offset }, allowed);
  const fixture = useFixture();
  const summary = useQuery({ queryKey: ["v2", "admin", fixture, "audit", "summary"], queryFn: api.getAuditSummary, staleTime: 60_000, retry: false, enabled: allowed });
  const kinds = useMemo(() => [...new Set((summary.data?.summary ?? []).map((r) => r.entity_type).filter((x): x is string => !!x))].sort(), [summary.data]);
  const who = (e: AuditEntry) => (e.actor_email ? (users.data?.users.find((u) => u.id === e.actor_user_id)?.name ?? e.actor_email) : "The system");
  const columns = useMemo(() => AUDIT_COLUMNS(who), [users.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!allowed) return <AdminPage title="Audit log"><NeedsPermission what="Reading the audit log" permission="view_audit" /></AdminPage>;
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
      title="Audit log"
      lead={`${summary.data?.total != null ? `${int(summary.data.total)} events recorded in the last 30 days. ` : ""}A permanent record of who changed what, every call to the language model, and every change to a user. Export it for an auditor.`}
      actions={
        <>
          <button type="button" className="m2-btn" disabled={exporting !== null || badRange} onClick={() => void exportAs("csv")}>
            {exporting === "csv" ? "Exporting…" : "Export CSV"}
          </button>
          <button type="button" className="m2-btn" disabled={exporting !== null || badRange} onClick={() => void exportAs("xlsx")}>
            {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
          </button>
        </>
      }
    >
      {error ? <ErrorFrame>{`The export did not finish. ${error}`}</ErrorFrame> : null}
      <Block>
        <div className="m2-fbar" role="search" aria-label="Filter the audit log">
          {can("manage_users") ? (
            <Fld label="Who">
              <select value={actor} onChange={(e) => reset(() => setActor(e.target.value))}>
                <option value="">Anyone</option>
                {(users.data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Fld>
          ) : null}
          <Fld label="Action contains">
            <input value={action} placeholder="user.invite" onChange={(e) => reset(() => setAction(e.target.value))} />
          </Fld>
          <Fld label="Object kind">
            <select value={object} onChange={(e) => reset(() => setObject(e.target.value))}>
              <option value="">Any</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {labelOf(k)}
                </option>
              ))}
            </select>
          </Fld>
          <Fld label="From">
            <input type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </Fld>
          <Fld label="To" error={badRange ? "Ends before it starts" : null}>
            <input type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} />
          </Fld>
          {filtered ? (
            <button type="button" className="m2-btn" onClick={() => reset(() => (setActor(""), setAction(""), setObject(""), setFrom(""), setTo("")))}>
              Clear filters
            </button>
          ) : null}
        </div>
        <ToolGrid<AuditEntry>
          toolsTitle="Audit log"
          id="admin-audit"
          ariaLabel="Audit log"
          columns={columns}
          rows={q.data?.entries ?? []}
          rowId={(e) => e.id}
          loading={q.isPending}
          count={q.data?.total}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{`The audit log could not be read. ${apiErrorMessage(q.error)}`}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{filtered ? "Nothing matches these filters. Widen the dates or pick someone else." : "No events recorded yet."}</EmptyFrame>}
          onOpen={(e) => openItem({ kind: "audit", id: e.id })}
          openRowId={open?.kind === "audit" ? open.id : null}
          fixedColumns
        />
        {q.data ? <Pager offset={offset} limit={PAGE} total={q.data.total} onPage={setOffset} /> : null}
        <p className="m2-prov">{since(q.data?.entries[0]?.created_at, "No event yet") === "No event yet" ? "" : `Latest event ${since(q.data?.entries[0]?.created_at)}.`}</p>
      </Block>
      <AiAudit />
    </AdminPage>
  );
}
