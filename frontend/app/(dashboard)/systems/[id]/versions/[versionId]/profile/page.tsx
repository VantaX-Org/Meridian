"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Banner, Button, Chip, KpiRail, Panel, Select, Stack, Stat, Text } from "@/components/aurora";
import { PageHead } from "@/components/meridian/atoms";
import {
  acceptDependency,
  getVersionProfile,
  type FieldDependency,
  type FieldStats,
  type MaskReason,
  type TableProfile,
} from "@/lib/api/field-profile";
import { getSystemVersions } from "@/lib/api/system-objects";
import { formatModuleName } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";

const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)] align-top";

const MASK_LABEL: Record<MaskReason, string> = {
  privacy: "masked — personal data",
  not_code_like: "masked — not a code field",
};

const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits)} %`;
const fieldName = (qualified: string) => qualified.split(".").slice(1).join(".") || qualified;

function range(s: FieldStats): string {
  if (s.numeric && s.numeric.min !== null && s.numeric.max !== null) {
    const mean = s.numeric.mean !== null ? ` · mean ${s.numeric.mean.toLocaleString()}` : "";
    const bad = s.numeric.non_numeric ? ` · ${s.numeric.non_numeric.toLocaleString()} not numeric` : "";
    return `${s.numeric.min.toLocaleString()} … ${s.numeric.max.toLocaleString()}${mean}${bad}`;
  }
  if (s.dates && s.dates.min && s.dates.max) {
    const bad = s.dates.invalid ? ` · ${s.dates.invalid.toLocaleString()} invalid` : "";
    return `${s.dates.min} … ${s.dates.max}${bad}`;
  }
  return "—";
}

function TopValues({ stats }: { stats: FieldStats }) {
  if (!stats.top_values) {
    return <Chip tone="neutral">{MASK_LABEL[stats.mask_reason ?? "privacy"]}</Chip>;
  }
  if (!stats.top_values.length) return <span className="text-[var(--aurora-fg-muted)]">—</span>;
  const filled = stats.rows - stats.blank;
  return (
    <div className="font-mono text-[12px]">
      {stats.top_values.map((v) => (
        <div key={v.value}>
          {v.value}{" "}
          <span className="aurora-number text-[var(--aurora-fg-tertiary)]">
            {v.count.toLocaleString()}{filled > 0 ? ` · ${pct(v.count / filled)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function TablePanel({ table }: { table: TableProfile }) {
  return (
    <Panel
      title={<span className="font-mono">{table.table}</span>}
      action={
        <Text variant="text-small" tone="tertiary" numeric>
          {table.sampled
            ? `first ${table.rows.toLocaleString()} of ${table.table_rows.toLocaleString()} records`
            : `${table.rows.toLocaleString()} records`}
          {" · "}{table.fields.length} fields
        </Text>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr>
            <th className={th}>Field</th><th className={th}>Type</th>
            <th className={`${th} text-right`}>Blank</th><th className={`${th} text-right`}>Distinct</th>
            <th className={`${th} text-right`}>Length</th><th className={th}>Range</th>
            <th className={th}>Top shapes</th><th className={th}>Top values</th>
          </tr></thead>
          <tbody>
            {table.fields.map(({ field, stats }) => (
              <tr key={field}>
                <td className={td}>
                  <div className="font-mono">{field}</div>
                  {stats.description && <div className="text-[12px] text-[var(--aurora-fg-tertiary)]">{stats.description}</div>}
                </td>
                <td className={`${td} font-mono text-[12px]`}>
                  {stats.ddic_type ? `${stats.ddic_type} ${stats.ddic_length ?? ""}` : "—"}
                </td>
                <td className={`${td} text-right aurora-number`} title={`${stats.blank.toLocaleString()} blank`}>
                  {stats.blank_pct.toFixed(1)} %
                </td>
                <td className={`${td} text-right aurora-number`}>{stats.distinct.toLocaleString()}</td>
                <td className={`${td} text-right aurora-number`}>
                  {stats.min_length === null ? "—"
                    : stats.min_length === stats.max_length ? stats.min_length : `${stats.min_length}–${stats.max_length}`}
                </td>
                <td className={`${td} aurora-number text-[12px]`}>{range(stats)}</td>
                <td className={td}>
                  <div className="font-mono text-[12px]">
                    {stats.shapes.map((s) => (
                      <div key={s.shape}>
                        {s.shape} <span className="aurora-number text-[var(--aurora-fg-tertiary)]">{pct(s.share)}</span>
                      </div>
                    ))}
                    {stats.shape_count > stats.shapes.length && (
                      <div className="text-[var(--aurora-fg-muted)]">+{stats.shape_count - stats.shapes.length} more</div>
                    )}
                    {!stats.shapes.length && <span className="text-[var(--aurora-fg-muted)]">—</span>}
                  </div>
                </td>
                <td className={td}><TopValues stats={stats} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function HiddenRules({ deps, module }: { deps: FieldDependency[]; module: string | null }) {
  const qc = useQueryClient();
  const canAccept = useRole().can("manage_rules") && !!module;
  const accept = useMutation({
    mutationFn: (d: FieldDependency) =>
      acceptDependency({ module: module ?? "", determinant: d.determinant, dependent: d.dependent }),
    onSuccess: (r) => {
      toast.success(`${r.name.split(":")[0]} added — it runs on the next analysis`);
      void qc.invalidateQueries({ queryKey: ["version-profile"] });
    },
    onError: () => toast.error("Could not add the check"),
  });
  return (
    <Panel title="Hidden rules (candidates)">
      <Stack gap={3}>
        <Text variant="text-small" tone="secondary">
          Within one table, one field decides another for at least 99 % — but not all — of the records. The
          disagreeing records are either errors or exceptions to a rule nobody wrote down. Accept one to run it as a
          check on every later analysis.
        </Text>
        {deps.length === 0 ? (
          <Text tone="muted">No candidate rules in this object&apos;s data.</Text>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr>
                <th className={th}>Rule</th><th className={`${th} text-right`}>Holds for</th>
                <th className={`${th} text-right`}>Disagree</th><th className={th}>Sample records</th><th className={th} />
              </tr></thead>
              <tbody>
                {deps.map((d) => (
                  <tr key={`${d.determinant}>${d.dependent}`}>
                    <td className={td}>
                      <div className="font-mono">{d.determinant} → {d.dependent}</div>
                      <div className="text-[12px] text-[var(--aurora-fg-tertiary)]">
                        {fieldName(d.determinant)} determines {fieldName(d.dependent)} in {pct(d.support)} of{" "}
                        {d.rows.toLocaleString()} {d.table} records; {d.violations.toLocaleString()} disagree
                      </div>
                    </td>
                    <td className={`${td} text-right aurora-number`}>{pct(d.support, 2)}</td>
                    <td className={`${td} text-right aurora-number`}>{d.violations.toLocaleString()}</td>
                    <td className={`${td} font-mono text-[12px]`}>
                      {d.sample_keys.map((k) => <div key={k}>{k}</div>)}
                      {d.violations > d.sample_keys.length && (
                        <div className="text-[var(--aurora-fg-muted)]">+{(d.violations - d.sample_keys.length).toLocaleString()} more</div>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {d.accepted ? (
                        <Chip tone="success">Check</Chip>
                      ) : canAccept ? (
                        <Button size="sm" variant="ghost" disabled={accept.isPending} onClick={() => accept.mutate(d)}>
                          Accept as check
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Stack>
    </Panel>
  );
}

export default function VersionProfilePage() {
  const { id, versionId } = useParams<{ id: string; versionId: string }>();
  const [objectParam, setObject] = useUrlState("object", "");
  const { data, error, isLoading } = useQuery({
    queryKey: ["version-profile", id, versionId, objectParam],
    queryFn: () => getVersionProfile(id, versionId, objectParam || undefined),
  });
  const { data: versions = [] } = useQuery({
    queryKey: ["system-versions", id],
    queryFn: () => getSystemVersions(id),
    select: (d) => d.versions,
  });
  const version = versions.find((v) => v.id === versionId);
  const object = data?.object ?? (objectParam || null);
  const tables = data?.tables ?? [];
  const fields = tables.reduce((n, t) => n + t.fields.length, 0);
  const masked = tables.reduce((n, t) => n + t.fields.filter((f) => f.stats.mask_reason === "privacy").length, 0);
  const options = Array.from(new Set([...(data?.objects ?? []), ...(object ? [object] : [])]))
    .map((o) => ({ value: o, label: formatModuleName(o) }));

  return (
    <div className="space-y-6">
      <Link href={`/systems/${id}?tab=versions`}
        className="inline-flex items-center gap-1 text-[13px] text-[var(--aurora-fg-secondary)] hover:underline">
        <ArrowLeft size={14} /> Versions
      </Link>
      <PageHead
        title={`Field profile${object ? ` · ${formatModuleName(object)}` : ""}`}
        sub={`${version ? `${new Date(version.run_at).toLocaleString()}${version.label ? ` · ${version.label}` : ""} — ` : ""}what the analysed data actually looks like, field by field: blanks, distinct values, formats and candidate rules hidden in the data.`}
        actions={options.length > 1 ? (
          <Select aria-label="Object" options={options} value={object ?? undefined} onValueChange={setObject} />
        ) : undefined}
      />

      {error ? <Banner tone="danger" title="Could not load the profile">{(error as Error).message}</Banner> : null}

      {isLoading ? <Text tone="muted">Loading the profile…</Text> : data && tables.length === 0 ? (
        <Banner tone="info" title="No profile for this object">
          Profiles are built when a version is analysed. Re-analyse this version to profile its data.
        </Banner>
      ) : data && (
        <>
          <KpiRail>
            <Stat label="Tables" value={tables.length.toLocaleString()} />
            <Stat label="Fields" value={fields.toLocaleString()} />
            <Stat label="Hidden rule candidates" value={data.dependencies.length.toLocaleString()} />
            <Stat label="Fields masked for privacy" value={masked.toLocaleString()} />
          </KpiRail>
          {tables.some((t) => t.sampled) && (
            <Banner tone="info" title="Large tables were profiled on their first 200,000 records">
              Counts and shares for {tables.filter((t) => t.sampled).map((t) => t.table).join(", ")} describe that
              sample; the checks themselves ran on every record.
            </Banner>
          )}
          <HiddenRules deps={data.dependencies} module={data.object} />
          {tables.map((t) => <TablePanel key={t.table} table={t} />)}
        </>
      )}
    </div>
  );
}
