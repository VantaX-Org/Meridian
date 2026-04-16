"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Info,
  ShieldCheck,
  CircleDot,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getRules, getRulesSummary } from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import { PermissionDenied } from "@/components/role-gate";
import { useRole } from "@/hooks/use-role";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-primary/10 text-primary border-primary/20",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

const CATEGORY_LABELS: Record<string, string> = {
  ecc: "ECC",
  successfactors: "SuccessFactors",
  warehouse: "Warehouse",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${
        SEVERITY_STYLES[severity] ?? "bg-gray-100 text-gray-600 border-gray-200"
      }`}
    >
      {severity}
    </span>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
        enabled ? "bg-[#16A34A]/15 text-[#16A34A]" : "bg-gray-100 text-gray-400"
      }`}
      title={enabled ? "Enabled" : "Disabled"}
    >
      <CircleDot className="h-3 w-3" />
    </span>
  );
}

// ── Module group ──────────────────────────────────────────────────────────────

function ModuleGroup({ moduleName, rules }: { moduleName: string; rules: Rule[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-black/[0.07] bg-white/[0.60] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-semibold text-foreground capitalize">
            {moduleName.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-muted-foreground">({rules.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#16A34A] font-medium">
            {rules.filter((r) => r.enabled).length} enabled
          </span>
          {rules.filter((r) => r.severity === "critical").length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {rules.filter((r) => r.severity === "critical").length} critical
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-black/[0.04]">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02] transition-colors"
            >
              <EnabledBadge enabled={rule.enabled} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground truncate">
                    {rule.name}
                  </span>
                  <SeverityBadge severity={rule.severity} />
                  {rule.source === "hq" && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary border border-primary/20">
                      HQ
                    </span>
                  )}
                </div>
                {rule.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {rule.description}
                  </p>
                )}
                {rule.source_yaml && (
                  <p className="mt-0.5 text-xs text-muted-foreground/60 font-mono">
                    {rule.source_yaml}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RulesPage() {
  const { isAdmin } = useRole();

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterSeverity, setFilterSeverity] = useState<string>("");
  const [filterEnabled, setFilterEnabled] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["rules", filterCategory, filterSeverity, filterEnabled, search],
    queryFn: () =>
      getRules({
        category: filterCategory || undefined,
        severity: filterSeverity || undefined,
        enabled:
          filterEnabled === "true"
            ? true
            : filterEnabled === "false"
            ? false
            : undefined,
        search: search || undefined,
        limit: 1000,
      }),
  });

  const { data: summary } = useQuery({
    queryKey: ["rules-summary"],
    queryFn: getRulesSummary,
  });

  if (!isAdmin) {
    return (
      <PermissionDenied message="Rules Engine is only accessible to administrators." />
    );
  }

  // Group rules by category → module
  const groupedByCategory: Record<string, Record<string, Rule[]>> = {};
  for (const rule of data?.rules ?? []) {
    if (!groupedByCategory[rule.category]) groupedByCategory[rule.category] = {};
    if (!groupedByCategory[rule.category][rule.module])
      groupedByCategory[rule.category][rule.module] = [];
    groupedByCategory[rule.category][rule.module].push(rule);
  }

  const totalRules = data?.total ?? 0;
  const enabledCount =
    summary?.summary.reduce(
      (acc, s) => acc + (s.enabled ? Number(s.count) : 0),
      0
    ) ?? 0;
  const criticalCount =
    summary?.summary.reduce(
      (acc, s) => acc + (s.severity === "critical" ? Number(s.count) : 0),
      0
    ) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            Rules Engine
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Check engine validation rules across all 29 SAP modules. Rules are managed centrally
            by your Meridian administrator.
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm text-foreground/80">
          Rules are managed centrally by your Meridian administrator. To request changes,
          disable a rule, or add custom rules, contact support or use the Meridian HQ portal.
          Local changes sync automatically during the next licence check-in.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Rules", value: totalRules, color: "text-foreground" },
          { label: "Enabled", value: enabledCount, color: "text-[#16A34A]" },
          { label: "Critical", value: criticalCount, color: "text-red-600" },
          {
            label: "Modules",
            value: Object.values(groupedByCategory).reduce(
              (a, c) => a + Object.keys(c).length,
              0
            ),
            color: "text-primary",
          },
        ].map(({ label, value, color }) => (
          <Card key={label} className="vx-card">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              {isLoading ? (
                <Skeleton className="mt-1 h-7 w-16" />
              ) : (
                <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="vx-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search rules..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
              />
            </div>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">All Categories</option>
              <option value="ecc">ECC</option>
              <option value="successfactors">SuccessFactors</option>
              <option value="warehouse">Warehouse</option>
            </select>

            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>

            <select
              value={filterEnabled}
              onChange={(e) => setFilterEnabled(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">All Statuses</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>

            {(filterCategory || filterSeverity || filterEnabled || search) && (
              <button
                type="button"
                onClick={() => {
                  setFilterCategory("");
                  setFilterSeverity("");
                  setFilterEnabled("");
                  setSearch("");
                }}
                className="rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rules by category */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : Object.keys(groupedByCategory).length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/[0.10] py-16 text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {totalRules === 0 && !isLoading
              ? "No rules found. Run migrations to seed rules from YAML files."
              : "No rules match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["ecc", "successfactors", "warehouse"] as const).map((cat) => {
            const catRules = groupedByCategory[cat];
            if (!catRules) return null;
            return (
              <div key={cat}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span>
                    {Object.values(catRules).flat().length} rules across{" "}
                    {Object.keys(catRules).length} modules
                  </span>
                </h2>
                <div className="space-y-2">
                  {Object.entries(catRules)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([mod, rules]) => (
                      <ModuleGroup key={mod} moduleName={mod} rules={rules} />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
