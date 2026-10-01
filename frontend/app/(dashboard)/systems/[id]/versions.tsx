"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Play } from "lucide-react";
import {
  Banner,
  Button,
  Chip,
  Field,
  Input,
  LineChart,
  Panel,
  Stack,
  Text,
  type ChipTone,
} from "@/components/aurora";
import {
  analyseVersion,
  getSystemObjects,
  getSystemVersions,
  getTrends,
  startDownload,
  type DownloadScope,
  type ScopeKey,
  type TrendFlag,
} from "@/lib/api/system-objects";
import { formatModuleName, relativeTime } from "@/lib/format";

const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)]";

const SCOPE_LABEL: Record<ScopeKey, string> = {
  company_codes: "Company codes",
  plants: "Plants",
  sales_orgs: "Sales organisations",
  purchasing_orgs: "Purchasing organisations",
};

const FLAG_LABEL: Record<TrendFlag, string> = {
  scope_changed: "different scope",
  rules_changed: "different rule set",
  volume_shift: "record count moved >20 %",
};

const COVERAGE_LABEL: Record<string, string> = {
  live: "read incompletely",
  failed: "read failed",
  not_in_system: "not in this system",
  not_installed: "function not installed",
  no_rule_mapping: "no rules for this system type",
};

const STATUS_TONE: Record<string, ChipTone> = {
  extracted: "info", pending: "info", running: "info", complete: "success", failed: "danger",
};

/** Findings of one object in one version. */
const findingsHref = (versionId: string, object: string) =>
  `/findings?${new URLSearchParams({ version_id: versionId, module: object })}`;

/** Field profile + candidate hidden rules of one object in one version. */
const profileHref = (systemId: string, versionId: string, object: string) =>
  `/systems/${systemId}/versions/${versionId}/profile?${new URLSearchParams({ object })}`;

const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const delta = (n: number | undefined, invert = false, digits = 1) => {
  if (n === undefined || n === null) return <span className="text-[var(--aurora-fg-muted)]">—</span>;
  const good = invert ? n < 0 : n > 0;
  const tone = n === 0 ? "neutral" : good ? "success" : "danger";
  return <Chip tone={tone}>{n > 0 ? "+" : ""}{Number(n).toFixed(digits)}</Chip>;
};

// ── choose objects → new version ─────────────────────────────────────────────

export function ObjectsPanel({ id, onDownloaded }: { id: string; onDownloaded: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["system-objects", id], queryFn: () => getSystemObjects(id) });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scopeText, setScopeText] = useState<Partial<Record<ScopeKey, string>>>({});
  const [dates, setDates] = useState<{ date_from?: string; date_to?: string }>({});
  const [label, setLabel] = useState("");

  const objects = data?.objects ?? [];
  const chosen = objects.filter((o) => picked.has(o.object));
  const filters = Array.from(new Set(chosen.flatMap((o) => o.scope_filters)));
  const windowed = chosen.flatMap((o) => o.date_window);

  const download = useMutation({
    mutationFn: (analyse: boolean) => {
      const scope: DownloadScope = { ...dates };
      for (const k of filters) {
        const v = list(scopeText[k] ?? "");
        if (v.length) scope[k] = v;
      }
      return startDownload(id, { objects: Array.from(picked), scope, label: label || undefined, analyse });
    },
    onSuccess: (_, analyse) => {
      toast.success(analyse ? "Download started — analysis follows automatically" : "Download started — a new version will appear under Versions");
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["system-versions", id] });
      onDownloaded();
    },
    onError: (e) => toast.error((e as Error).message || "Download refused"),
  });

  const toggle = (o: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    return next;
  });

  return (
    <Panel title="Download objects into a new version">
      {isLoading ? <Text tone="muted">Reading which objects this system offers…</Text> : (
        <Stack gap={4}>
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={th} /><th className={th}>Object</th><th className={th}>Tables</th>
              <th className={th}>Last download</th><th className={`${th} text-right`}>Records</th>
            </tr></thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.object} className="cursor-pointer hover:bg-[var(--aurora-elev-2-bg)]" onClick={() => toggle(o.object)}>
                  <td className={td}><input type="checkbox" checked={picked.has(o.object)} readOnly aria-label={`Select ${o.object}`} /></td>
                  <td className={td}>{formatModuleName(o.object)}</td>
                  <td className={`${td} font-mono`} title={o.tables.join(", ")}>
                    {o.tables.slice(0, 5).join(", ")}{o.tables.length > 5 ? ` +${o.tables.length - 5}` : ""}
                  </td>
                  <td className={td}>{o.last_download ? relativeTime(o.last_download.at) : "never"}</td>
                  <td className={`${td} text-right aurora-number`}>{o.last_download?.records?.toLocaleString() ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {chosen.length > 0 && (
            <Stack gap={3}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filters.map((k) => (
                  <Field key={k} label={SCOPE_LABEL[k]} helper="Comma-separated; empty = all">
                    {({ controlId }) => (
                      <Input id={controlId} value={scopeText[k] ?? ""} placeholder="e.g. 1000, 2000"
                        onChange={(e) => setScopeText({ ...scopeText, [k]: e.target.value })} />
                    )}
                  </Field>
                ))}
                {windowed.length > 0 && (
                  <>
                    <Field label="Documents from" helper={`Replaces the default window for ${windowed.join(", ")}`}>
                      {({ controlId }) => <Input id={controlId} type="date" value={dates.date_from ?? ""}
                        onChange={(e) => setDates({ ...dates, date_from: e.target.value || undefined })} />}
                    </Field>
                    <Field label="Documents to">
                      {({ controlId }) => <Input id={controlId} type="date" value={dates.date_to ?? ""}
                        onChange={(e) => setDates({ ...dates, date_to: e.target.value || undefined })} />}
                    </Field>
                  </>
                )}
                <Field label="Version label" helper="Optional, e.g. “Before vendor clean-up”">
                  {({ controlId }) => <Input id={controlId} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}
                </Field>
              </div>
              <Text variant="text-small" tone="secondary">
                Organisational filters restrict every table that carries the field (e.g. LFB1 by company code);
                general data without it (e.g. LFA1) is read in full so no record loses its context.
              </Text>
              <Stack direction="row" gap={2}>
                <Button variant="secondary" leadingIcon={<Download size={14} />} disabled={download.isPending}
                  onClick={() => download.mutate(false)}>
                  Download {chosen.length} object{chosen.length === 1 ? "" : "s"} to a new version
                </Button>
                <Button leadingIcon={<Play size={14} />} disabled={download.isPending} onClick={() => download.mutate(true)}>
                  Download and analyse
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      )}
    </Panel>
  );
}

// ── versions of this system ──────────────────────────────────────────────────

export function VersionsTab({ id, canAnalyse }: { id: string; canAnalyse: boolean }) {
  const qc = useQueryClient();
  const { data: versions = [] } = useQuery({
    queryKey: ["system-versions", id],
    queryFn: () => getSystemVersions(id),
    refetchInterval: (q) => ((q.state.data ?? []).some((v) => ["pending", "running"].includes(v.status)) ? 4000 : false),
  });
  const analyse = useMutation({
    mutationFn: analyseVersion,
    onSuccess: () => { toast.success("Analysis started"); qc.invalidateQueries({ queryKey: ["system-versions", id] }); },
    onError: (e) => toast.error((e as Error).message || "Analysis refused"),
  });
  if (!versions.length) return <Text tone="muted">No versions yet — choose objects above and download them.</Text>;
  return (
    <table className="w-full text-[13px]">
      <thead><tr>
        <th className={th}>Downloaded</th><th className={th}>Label</th><th className={th}>Objects · records</th>
        <th className={th}>Scope</th><th className={th}>Status</th><th className={th}>Analysed · rules</th>
        <th className={th}>DQS per object</th><th className={th} />
      </tr></thead>
      <tbody>
        {versions.map((v) => (
          <tr key={v.id}>
            <td className={td}>{new Date(v.run_at).toLocaleString()}{v.baseline && <> <Chip tone="info">baseline</Chip></>}</td>
            <td className={td}>{v.label ?? "—"}</td>
            <td className={td}>
              {v.objects.map((o) => (
                <div key={o}>{formatModuleName(o)} <span className="aurora-number text-[var(--aurora-fg-tertiary)]">{v.records[o]?.toLocaleString() ?? ""}</span></div>
              ))}
            </td>
            <td className={`${td} font-mono text-[12px]`}>
              {Object.entries(v.scope).map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(",") : val}`).join(" · ") || "all"}
            </td>
            <td className={td}><Chip tone={STATUS_TONE[v.status] ?? "neutral"}>{v.status === "extracted" ? "downloaded, not analysed" : v.status}</Chip></td>
            <td className={td}>
              {v.analysed_at ? <div>{new Date(v.analysed_at).toLocaleString()}</div> : <span className="text-[var(--aurora-fg-muted)]">—</span>}
              {v.rule_set && <div className="font-mono text-[11px] text-[var(--aurora-fg-tertiary)]" title={v.rule_set}>rules {v.rule_set.slice(0, 8)}</div>}
              {v.field_status.length > 0 && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-[var(--aurora-fg-tertiary)]">
                    field status · {v.field_status.reduce((n, f) => n + f.rules, 0)} rules
                  </summary>
                  {v.field_status.map((f) => (
                    <div key={f.segment} className="font-mono">
                      {f.segment}: {f.definition ?? "—"} <span className="text-[var(--aurora-fg-tertiary)]">({f.reason ?? "no reason"}) · {f.rules}</span>
                    </div>
                  ))}
                </details>
              )}
              {v.extraction_complete === false && (
                <div className="text-[12px] text-[var(--aurora-status-warning-500)]">extraction incomplete — see coverage</div>
              )}
              {v.coverage && v.coverage.issues.length > 0 && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-[var(--aurora-fg-tertiary)]">
                    coverage · {v.coverage.read} tables read, {v.coverage.issues.length} not complete
                  </summary>
                  {v.coverage.issues.map((c) => (
                    <div key={c.table} title={c.detail ?? undefined}>
                      <span className="font-mono">{c.table}</span>{" "}
                      <span className="text-[var(--aurora-fg-tertiary)]">
                        {COVERAGE_LABEL[c.status] ?? c.status}
                        {c.source_rows != null && c.rows != null && c.source_rows !== c.rows
                          ? ` · ${c.rows.toLocaleString()} of ${c.source_rows.toLocaleString()} rows` : ""}
                        {c.detail ? ` · ${c.detail}` : ""}
                      </span>
                    </div>
                  ))}
                </details>
              )}
              {Object.values(v.outliers ?? {}).some((o) => o.outliers > 0) && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-[var(--aurora-fg-tertiary)]">
                    peer outliers · {Object.values(v.outliers).reduce((n, o) => n + o.outliers, 0)} (not scored)
                  </summary>
                  {Object.entries(v.outliers).filter(([, o]) => o.outliers > 0).map(([id, o]) => (
                    <div key={id}>{o.label}: <span className="aurora-number">{o.outliers}</span> of {o.checked}</div>
                  ))}
                </details>
              )}
            </td>
            <td className={td}>
              {Object.entries(v.dqs).map(([o, d]) => (
                <div key={o}>
                  <Link className="underline" href={findingsHref(v.id, o)}>
                    {formatModuleName(o)} <span className="aurora-number">{d?.toFixed(1) ?? "—"}</span>
                  </Link>{" "}
                  <Link className="text-[12px] text-[var(--aurora-fg-tertiary)] underline" href={profileHref(id, v.id, o)}>
                    Profile
                  </Link>
                </div>
              ))}
            </td>
            <td className={`${td} text-right`}>
              <Stack direction="row" gap={2} justify="end">
                {canAnalyse && v.analysable && (
                  <Button size="sm" variant={v.status === "extracted" ? "primary" : "ghost"} disabled={analyse.isPending}
                    onClick={() => analyse.mutate(v.id)}>
                    {v.status === "extracted" ? "Run analysis" : "Re-analyse"}
                  </Button>
                )}
                {Object.keys(v.dqs).length > 0 && (
                  <>
                    <Link className="text-[13px] underline" href={`/findings?version_id=${v.id}`}>Findings</Link>
                    <Link className="text-[13px] underline" href={`/reports?version_id=${v.id}`}>Report</Link>
                  </>
                )}
              </Stack>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── trends per object ────────────────────────────────────────────────────────

export function TrendsTab({ id }: { id: string }) {
  const router = useRouter();
  const { data: overview } = useQuery({ queryKey: ["trends", id], queryFn: () => getTrends(id) });
  const [object, setObject] = useState<string | null>(null);
  const active = object ?? overview?.summary[0]?.object ?? null;
  const { data: detail } = useQuery({
    queryKey: ["trends", id, active],
    queryFn: () => getTrends(id, active as string),
    enabled: Boolean(active),
  });
  const points = active ? detail?.series[active] ?? [] : [];

  if (!overview?.summary.length) {
    return <Text tone="muted">Trends appear once this system has at least one analysed version — each new download adds a point.</Text>;
  }
  return (
    <Stack gap={5}>
      <table className="w-full text-[13px]">
        <thead><tr>
          <th className={th}>Object</th><th className={`${th} text-right`}>DQS</th><th className={th}>vs previous</th>
          <th className={th}>vs baseline</th><th className={`${th} text-right`}>Failing records</th><th className={th}>vs previous</th>
          <th className={th}>Versions</th><th className={th} />
        </tr></thead>
        <tbody>
          {overview.summary.map((s) => (
            <tr key={s.object} onClick={() => setObject(s.object)}
              className={`cursor-pointer hover:bg-[var(--aurora-elev-2-bg)] ${s.object === active ? "bg-[var(--aurora-accent-selected-bg)]" : ""}`}>
              <td className={td}>{formatModuleName(s.object)}</td>
              <td className={`${td} text-right aurora-number`}>{s.dqs?.toFixed(1) ?? "—"}</td>
              <td className={td}>{delta(s.dqs_delta)}</td>
              <td className={td}>{s.vs_baseline ? <>{delta(s.vs_baseline.dqs_delta)} <span className="text-[11px] text-[var(--aurora-fg-muted)]">{s.vs_baseline.pinned ? "pinned" : "first version"}</span></> : "—"}</td>
              <td className={`${td} text-right aurora-number`}>{s.failing_records.toLocaleString()}</td>
              <td className={td}>{delta(s.failing_records_delta, true, 0)}</td>
              <td className={`${td} aurora-number`}>{s.points}</td>
              <td className={td}>{!s.comparable && <Chip tone="warning">not like-for-like</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {active && points.length > 0 && (
        <Stack gap={3}>
          <Text variant="text-lead">{formatModuleName(active)}</Text>
          {points.some((p) => !p.comparable) && (
            <Banner tone="warning" title="Some versions are not like-for-like">
              A change there may come from what was downloaded or which rules ran, not from the data getting better or worse.
            </Banner>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LineChart ariaLabel="DQS per version — select a point for its findings" height={220}
              data={points.map((p) => ({ run: new Date(p.run_at).toLocaleDateString(), dqs: p.dqs ?? 0 }))}
              xKey="run" series={[{ key: "dqs", label: "DQS" }]} yFormatter={(v) => v.toFixed(0)}
              onPointClick={(i) => points[i] && router.push(findingsHref(points[i].version_id, active))} />
            <LineChart ariaLabel="Failing records per version — select a point for its findings" height={220}
              onPointClick={(i) => points[i] && router.push(findingsHref(points[i].version_id, active))}
              data={points.map((p) => ({ run: new Date(p.run_at).toLocaleDateString(), failing: p.failing_records,
                opened: p.issues_opened, resolved: p.issues_resolved }))}
              xKey="run" series={[{ key: "failing", label: "Failing records" }, { key: "opened", label: "Newly failing" },
                { key: "resolved", label: "Verified fixed" }]} />
          </div>
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={th}>Version</th><th className={`${th} text-right`}>Records</th><th className={`${th} text-right`}>DQS</th>
              <th className={th}>Δ</th><th className={th}>Dimensions</th><th className={`${th} text-right`}>Failing</th><th className={`${th} text-right`}>New</th>
              <th className={`${th} text-right`}>Fixed</th><th className={th}>Comparable</th><th className={th} />
            </tr></thead>
            <tbody>
              {points.map((p, i) => ({ p, prev: points[i - 1] })).reverse().map(({ p, prev }) => (
                <tr key={p.version_id}>
                  <td className={td}>{new Date(p.run_at).toLocaleString()} {p.label && <span className="text-[var(--aurora-fg-tertiary)]">· {p.label}</span>}{p.baseline && <> <Chip tone="info">baseline</Chip></>}</td>
                  <td className={`${td} text-right aurora-number`}>{p.records?.toLocaleString() ?? "—"}</td>
                  <td className={`${td} text-right aurora-number`}>{p.dqs?.toFixed(1) ?? "—"}</td>
                  <td className={td}>{delta(p.dqs_delta)}</td>
                  <td className={`${td} font-mono text-[11px]`} title={Object.entries(p.dimensions).map(([k, v]) => `${k} ${v?.toFixed(1) ?? "—"}`).join(" · ")}>
                    {Object.entries(p.dimensions).map(([k, v]) => `${k.slice(0, 4)} ${v?.toFixed(0) ?? "—"}`).join(" · ") || "—"}
                  </td>
                  <td className={`${td} text-right aurora-number`}>{p.failing_records.toLocaleString()}</td>
                  <td className={`${td} text-right aurora-number`}>{p.issues_opened.toLocaleString()}</td>
                  <td className={`${td} text-right aurora-number`}>{p.issues_resolved.toLocaleString()}</td>
                  <td className={td}>{p.comparable ? "yes" : p.flags.map((f) => <Chip key={f} tone="warning">{FLAG_LABEL[f]}</Chip>)}</td>
                  <td className={td}>
                    <Stack direction="row" gap={2}>
                      <Link className="underline" href={findingsHref(p.version_id, active)}>Findings</Link>
                      {prev && (
                        <Link className="underline" href={`/versions?${new URLSearchParams({
                          v1: prev.version_id, v2: p.version_id, module: active, system_id: id })}`}>
                          Compare
                        </Link>
                      )}
                    </Stack>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Stack>
      )}
    </Stack>
  );
}
