"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import * as d3 from "d3";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Zap,
  Target,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Gauge,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import apiClient from "@/lib/api/client";

// ── Types ───────────────────────────────────────────────────────────────────

interface Forecast {
  module_id: string;
  current_score: number;
  forecast_7d: number;
  forecast_30d: number;
  forecast_90d: number;
  trend: "improving" | "declining" | "critical" | "stable";
  confidence: number;
  contributing_factors: string[];
}

interface EarlyWarning {
  module_id: string;
  signal: "red" | "amber" | "green";
  message: string;
  recommended_action: string;
}

interface NextBestAction {
  type: string;
  id: string;
  title: string;
  priority_score: number;
  estimated_impact_zar: number;
  effort_hours: number;
  roi_per_hour: number;
  recommended_steward?: string;
}

interface Sprint {
  sprint_number: number;
  name: string;
  actions: NextBestAction[];
  total_effort_hours: number;
  total_impact_zar: number;
  projected_dqs_improvement: number;
}

interface ImpactCategory {
  category: string;
  annual_risk_zar: number;
  mitigated_zar: number;
  finding_count: number;
  calculation_method: string;
}

interface ROI {
  subscription_annual: number;
  risk_mitigated: number;
  roi_multiple: number;
  payback_months: number;
}

interface KPIs {
  throughput: number;
  automation_rate: number;
  mttr_hours: number;
  sla_compliance_pct: number;
  rejection_rate: number;
  rollback_rate: number;
  items_in_flight: number;
  avg_queue_age_hours: number;
  top_rule_by_volume: string;
  top_object_type: string;
  total_processed: number;
  total_detected: number;
}

interface Bottleneck {
  stage: string;
  count: number;
  avg_age_hours: number;
  recommendation: string;
}

interface Capacity {
  needed: number;
  current: number;
  surplus_deficit: number;
  recommendation: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatZAR(value: number): string {
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}K`;
  return `R${value.toFixed(0)}`;
}

const TREND_CONFIG = {
  improving: { color: "#16A34A", icon: TrendingUp, label: "Improving" },
  declining: { color: "#D97706", icon: TrendingDown, label: "Declining" },
  critical: { color: "#DC2626", icon: TrendingDown, label: "Critical" },
  stable: { color: "rgba(255,255,255,0.20)", icon: Minus, label: "Stable" },
} as const;

const SIGNAL_CONFIG = {
  red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500" },
  amber: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" },
  green: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
} as const;

const CATEGORY_COLORS: Record<string, string> = {
  duplicate_payment: "#DC2626",
  warranty_miss: "#EA580C",
  compliance_penalty: "#D97706",
  blocked_invoice: "#D97706",
  failed_posting: "#16A34A",
  inventory_write_off: "#16A34A",
  labour_displacement: "#3B82F6",
  contract_violation: "#7C3AED",
};

const CATEGORY_LABELS: Record<string, string> = {
  duplicate_payment: "Duplicate Payment",
  warranty_miss: "Warranty Miss",
  compliance_penalty: "Compliance Penalty",
  blocked_invoice: "Blocked Invoice",
  failed_posting: "Failed Posting",
  inventory_write_off: "Inventory Write-off",
  labour_displacement: "Labour Displacement",
  contract_violation: "Contract Violation",
};

// ── Section Toggle ──────────────────────────────────────────────────────────

function SectionToggle({
  sections,
  visible,
  onToggle,
}: {
  sections: { key: string; label: string }[];
  visible: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {sections.map((s) => (
        <button
          key={s.key}
          onClick={() => onToggle(s.key)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            visible.has(s.key)
              ? "bg-primary text-white"
              : "bg-accent text-muted-foreground hover:text-foreground"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function useToggle(keys: string[]): [Set<string>, (key: string) => void] {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(keys));
  const toggle = (key: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  return [visible, toggle];
}

// ── Predictive Tab ──────────────────────────────────────────────────────────

function PredictiveTab() {
  const [visible, toggle] = useToggle(["warnings", "forecasts"]);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "predictive"],
    queryFn: async () => (await apiClient.get("/api/v1/analytics/predictive")).data,
    staleTime: 60_000,
  });

  if (isLoading) return <TabSkeleton />;

  const forecasts: Forecast[] = data?.forecasts ?? [];
  const warnings: EarlyWarning[] = data?.early_warnings ?? [];

  return (
    <div className="space-y-6">
      <SectionToggle
        sections={[
          { key: "warnings", label: "Early Warnings" },
          { key: "forecasts", label: "DQS Forecasts" },
        ]}
        visible={visible}
        onToggle={toggle}
      />

      {/* Early Warnings */}
      {visible.has("warnings") && <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Early Warnings</h3>
        {warnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No warnings — all modules healthy</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {warnings.map((w) => {
              const cfg = SIGNAL_CONFIG[w.signal];
              return (
                <div
                  key={w.module_id}
                  className={`rounded-lg border p-4 ${cfg.bg} ${cfg.border}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
                    <span className={`text-sm font-semibold ${cfg.text}`}>
                      {w.module_id.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className={`text-xs ${cfg.text} mb-1`}>{w.message}</p>
                  <p className="text-xs text-muted-foreground">{w.recommended_action}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>}

      {/* Forecast Charts */}
      {visible.has("forecasts") && <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">DQS Forecasts</h3>
        {forecasts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not enough data points for forecasting (need at least 3 per module)
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {forecasts.map((fc) => {
              const trendCfg = TREND_CONFIG[fc.trend];
              const TrendIcon = trendCfg.icon;
              const chartData = [
                { label: "Current", score: fc.current_score },
                { label: "7d", score: fc.forecast_7d },
                { label: "30d", score: fc.forecast_30d },
                { label: "90d", score: fc.forecast_90d },
              ];

              return (
                <Card key={fc.module_id} className="border-black/[0.08]">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold text-foreground">
                        {fc.module_id.replace(/_/g, " ")}
                      </CardTitle>
                      <div className="flex items-center gap-1.5">
                        <TrendIcon
                          className="h-4 w-4"
                          style={{ color: trendCfg.color }}
                        />
                        <span
                          className="text-xs font-medium"
                          style={{ color: trendCfg.color }}
                        >
                          {trendCfg.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-foreground">
                        {fc.current_score.toFixed(1)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Confidence: {fc.confidence}%
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[140px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient
                              id={`grad-${fc.module_id}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor={trendCfg.color}
                                stopOpacity={0.2}
                              />
                              <stop
                                offset="95%"
                                stopColor={trendCfg.color}
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 11, fill: "rgba(255,255,255,0.40)" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 11, fill: "rgba(255,255,255,0.40)" }}
                            axisLine={false}
                            tickLine={false}
                            width={30}
                          />
                          <RechartsTooltip
                            contentStyle={{
                              fontSize: 12,
                              borderRadius: 8,
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="score"
                            stroke={trendCfg.color}
                            strokeWidth={2}
                            fill={`url(#grad-${fc.module_id})`}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    {fc.contributing_factors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {fc.contributing_factors.map((f, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            {f}
                          </p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>}
    </div>
  );
}

// ── Prescriptive Tab ────────────────────────────────────────────────────────

function PrescriptiveTab() {
  const [visible, toggle] = useToggle(["actions", "sprints"]);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "prescriptive"],
    queryFn: async () => (await apiClient.get("/api/v1/analytics/prescriptive")).data,
    staleTime: 60_000,
  });

  if (isLoading) return <TabSkeleton />;

  const actions: NextBestAction[] = data?.actions ?? [];
  const sprints: Sprint[] = data?.sprints ?? [];

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      finding: "bg-blue-100 text-blue-700",
      cleaning: "bg-emerald-100 text-emerald-700",
      exception: "bg-amber-100 text-amber-700",
    };
    return colors[type] || "bg-gray-100 text-gray-700";
  };

  return (
    <div className="space-y-6">
      <SectionToggle
        sections={[
          { key: "actions", label: "Next Best Actions" },
          { key: "sprints", label: "Sprint Planner" },
        ]}
        visible={visible}
        onToggle={toggle}
      />

      {/* Next Best Actions */}
      {visible.has("actions") && <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Next Best Actions
        </h3>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actionable items found</p>
        ) : (
          <Card className="border-black/[0.08]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Type</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Impact (ZAR)</TableHead>
                  <TableHead className="text-right">Effort (h)</TableHead>
                  <TableHead className="text-right">ROI/h</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((a, i) => (
                  <TableRow key={a.id || i}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${typeBadge(a.type)}`}
                      >
                        {a.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm">
                      {a.title}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatZAR(a.estimated_impact_zar)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {a.effort_hours}h
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-white/[0.65]">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{
                              width: `${Math.min(100, (a.roi_per_hour / 80) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium text-foreground w-8 text-right">
                          {a.roi_per_hour}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>}

      {/* Sprint Planner */}
      {visible.has("sprints") && <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Sprint Planner
        </h3>
        {sprints.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sprints generated</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {sprints.map((s) => (
              <Card key={s.sprint_number} className="border-black/[0.08]">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-foreground">
                      {s.name}
                    </CardTitle>
                    <Badge variant="outline" className="bg-primary/10 text-primary text-xs">
                      +{s.projected_dqs_improvement.toFixed(1)}% DQS
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
                    <span>{s.total_effort_hours}h effort</span>
                    <span>{formatZAR(s.total_impact_zar)} impact</span>
                    <span>{s.actions.length} actions</span>
                  </div>
                  <div className="space-y-1.5">
                    {s.actions.slice(0, 5).map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs text-foreground"
                      >
                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        <span className="truncate">{a.title}</span>
                      </div>
                    ))}
                    {s.actions.length > 5 && (
                      <p className="text-xs text-muted-foreground pl-3.5">
                        +{s.actions.length - 5} more actions
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>}
    </div>
  );
}

// ── Impact Tab ──────────────────────────────────────────────────────────────

function ImpactTreemap({
  impacts,
}: {
  impacts: ImpactCategory[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || impacts.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = 320;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const filtered = impacts.filter((d) => d.annual_risk_zar > 0);
    if (filtered.length === 0) return;

    const root = d3
      .hierarchy({ children: filtered } as any)
      .sum((d: any) => d.annual_risk_zar || 0);

    d3.treemap<any>().size([width, height]).padding(3).round(true)(root);

    const nodes = svg
      .selectAll("g")
      .data(root.leaves())
      .join("g")
      .attr("transform", (d: any) => `translate(${d.x0},${d.y0})`);

    nodes
      .append("rect")
      .attr("width", (d: any) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d: any) => Math.max(0, d.y1 - d.y0))
      .attr("rx", 4)
      .attr("fill", (d: any) => CATEGORY_COLORS[d.data.category] || "rgba(255,255,255,0.20)")
      .attr("opacity", 0.85);

    nodes
      .append("text")
      .attr("x", 6)
      .attr("y", 18)
      .text((d: any) => CATEGORY_LABELS[d.data.category] || d.data.category)
      .attr("fill", "white")
      .attr("font-size", "11px")
      .attr("font-weight", "600");

    nodes
      .append("text")
      .attr("x", 6)
      .attr("y", 34)
      .text((d: any) => formatZAR(d.data.annual_risk_zar))
      .attr("fill", "rgba(255,255,255,0.8)")
      .attr("font-size", "10px");
  }, [impacts]);

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} />
    </div>
  );
}

function ImpactTab() {
  const [visible, toggle] = useToggle(["roi", "treemap", "breakdown"]);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "impact"],
    queryFn: async () => (await apiClient.get("/api/v1/analytics/impact")).data,
    staleTime: 60_000,
  });

  if (isLoading) return <TabSkeleton />;

  const impacts: ImpactCategory[] = data?.impacts ?? [];
  const roi: ROI = data?.roi ?? {
    subscription_annual: 0,
    risk_mitigated: 0,
    roi_multiple: 0,
    payback_months: 0,
  };

  return (
    <div className="space-y-6">
      <SectionToggle
        sections={[
          { key: "roi", label: "ROI Summary" },
          { key: "treemap", label: "Impact Treemap" },
          { key: "breakdown", label: "Breakdown Table" },
        ]}
        visible={visible}
        onToggle={toggle}
      />

      {/* ROI Summary */}
      {visible.has("roi") && <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Subscription</p>
            <p className="text-xl font-bold text-foreground">
              {formatZAR(roi.subscription_annual)}
            </p>
            <p className="text-xs text-muted-foreground">annual</p>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Risk Mitigated</p>
            <p className="text-xl font-bold text-emerald-600">
              {formatZAR(roi.risk_mitigated)}
            </p>
            <p className="text-xs text-muted-foreground">annual</p>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">ROI Multiple</p>
            <p className="text-xl font-bold text-primary">
              {roi.roi_multiple}x
            </p>
            <p className="text-xs text-muted-foreground">return on investment</p>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Payback</p>
            <p className="text-xl font-bold text-foreground">
              {roi.payback_months} mo
            </p>
            <p className="text-xs text-muted-foreground">to break even</p>
          </CardContent>
        </Card>
      </div>}

      {/* Treemap */}
      {visible.has("treemap") && <Card className="border-black/[0.08]">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">
            Impact Treemap — Annual Risk (ZAR)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ImpactTreemap impacts={impacts} />
        </CardContent>
      </Card>}

      {/* Breakdown Table */}
      {visible.has("breakdown") && <Card className="border-black/[0.08]">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">
            Impact Breakdown
          </CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Annual Risk</TableHead>
              <TableHead className="text-right">Mitigated</TableHead>
              <TableHead className="text-right">Findings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {impacts.map((imp) => (
              <TableRow key={imp.category}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-sm"
                      style={{
                        backgroundColor:
                          CATEGORY_COLORS[imp.category] || "rgba(255,255,255,0.20)",
                      }}
                    />
                    <span className="text-sm">
                      {CATEGORY_LABELS[imp.category] || imp.category}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm font-medium">
                  {formatZAR(imp.annual_risk_zar)}
                </TableCell>
                <TableCell className="text-right text-sm text-emerald-600">
                  {formatZAR(imp.mitigated_zar)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {imp.finding_count}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>}
    </div>
  );
}

// ── Operational Tab ─────────────────────────────────────────────────────────

const KPI_META: {
  key: keyof KPIs;
  label: string;
  icon: typeof Activity;
  unit: string;
  good: "high" | "low";
}[] = [
  { key: "throughput", label: "Throughput", icon: Zap, unit: "/day", good: "high" },
  { key: "automation_rate", label: "Automation Rate", icon: BarChart3, unit: "%", good: "high" },
  { key: "mttr_hours", label: "MTTR", icon: Clock, unit: "h", good: "low" },
  { key: "sla_compliance_pct", label: "SLA Compliance", icon: Target, unit: "%", good: "high" },
  { key: "rejection_rate", label: "Rejection Rate", icon: ArrowDownRight, unit: "%", good: "low" },
  { key: "rollback_rate", label: "Rollback Rate", icon: ArrowDownRight, unit: "%", good: "low" },
  { key: "items_in_flight", label: "In Flight", icon: Activity, unit: "", good: "low" },
  { key: "avg_queue_age_hours", label: "Avg Queue Age", icon: Clock, unit: "h", good: "low" },
  { key: "top_rule_by_volume", label: "Top Rule", icon: BarChart3, unit: "", good: "high" },
  { key: "top_object_type", label: "Top Object", icon: Gauge, unit: "", good: "high" },
  { key: "total_processed", label: "Total Processed", icon: CheckCircle2, unit: "", good: "high" },
  { key: "total_detected", label: "Total Detected", icon: AlertTriangle, unit: "", good: "high" },
];

function OperationalTab() {
  const [visible, toggle] = useToggle(["kpis", "bottlenecks", "capacity"]);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "operational"],
    queryFn: async () =>
      (await apiClient.get("/api/v1/analytics/operational")).data,
    staleTime: 60_000,
  });

  const { data: teamData } = useQuery({
    queryKey: ["analytics", "operational", "stewards"],
    queryFn: async () => {
      return (await apiClient.get("/api/v1/analytics/capacity")).data;
    },
    staleTime: 60_000,
  });

  if (isLoading) return <TabSkeleton />;

  const kpis: KPIs = data?.kpis ?? ({} as KPIs);
  const bottlenecks: Bottleneck[] = data?.bottlenecks ?? [];
  const capacity: Capacity = data?.capacity ?? teamData ?? {
    needed: 0,
    current: 0,
    surplus_deficit: 0,
    recommendation: "",
  };

  return (
    <div className="space-y-6">
      <SectionToggle
        sections={[
          { key: "kpis", label: "KPIs" },
          { key: "bottlenecks", label: "Bottlenecks" },
          { key: "capacity", label: "Capacity" },
        ]}
        visible={visible}
        onToggle={toggle}
      />

      {/* KPI Grid */}
      {visible.has("kpis") && <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Key Performance Indicators
        </h3>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {KPI_META.map((meta) => {
            const Icon = meta.icon;
            const value = kpis[meta.key];
            const display =
              typeof value === "number"
                ? `${value}${meta.unit}`
                : (value ?? "—");

            return (
              <Card key={meta.key} className="border-black/[0.08]">
                <CardContent className="flex items-start gap-3 pt-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">
                      {meta.label}
                    </p>
                    <p className="text-lg font-bold text-foreground truncate">
                      {display}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>}

      {/* Bottlenecks */}
      {visible.has("bottlenecks") && <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Bottleneck Analysis
        </h3>
        {bottlenecks.length === 0 ? (
          <Card className="border-black/[0.08]">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm">
                  No bottlenecks detected — pipeline is flowing smoothly
                </span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bottlenecks.map((b) => (
              <Card key={b.stage} className="border-amber-200 bg-amber-50/50">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="bg-amber-100 text-amber-700 text-xs">
                      {b.stage}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {b.avg_age_hours}h avg
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-foreground mb-1">
                    {b.count}
                  </p>
                  <p className="text-xs text-muted-foreground">{b.recommendation}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>}

      {/* Capacity Planning */}
      {visible.has("capacity") && <Card className="border-black/[0.08]">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">
            Capacity Planning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3 mb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Needed</p>
              <p className="text-2xl font-bold text-foreground">
                {capacity.needed}
              </p>
              <p className="text-xs text-muted-foreground">stewards</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Current</p>
              <p className="text-2xl font-bold text-primary">
                {capacity.current}
              </p>
              <p className="text-xs text-muted-foreground">stewards</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Surplus / Deficit</p>
              <p
                className={`text-2xl font-bold ${
                  capacity.surplus_deficit >= 0
                    ? "text-emerald-600"
                    : "text-red-600"
                }`}
              >
                {capacity.surplus_deficit > 0 ? "+" : ""}
                {capacity.surplus_deficit}
              </p>
              <p className="text-xs text-muted-foreground">stewards</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{capacity.recommendation}</p>
        </CardContent>
      </Card>}
    </div>
  );
}

// ── MDM Health Tab ─────────────────────────────────────────────────────────

interface MDMHealthRow {
  snapshot_date: string;
  mdm_health_score: number;
  golden_record_coverage_pct: number | null;
  avg_match_confidence: number | null;
  steward_sla_compliance_pct: number | null;
  source_consistency_pct: number | null;
  backlog_count: number | null;
  ai_projected_score: number | null;
  ai_narrative: string | null;
  ai_risk_flags: string[] | null;
}

function MDMHealthTab() {
  const [visible, toggle] = useToggle(["summary", "trend", "insights"]);
  const { data: mdmHealth, isLoading } = useQuery({
    queryKey: ["analytics", "mdm-health"],
    queryFn: async () =>
      (await apiClient.get("/api/v1/analytics/mdm-health")).data as {
        data: MDMHealthRow[];
        days: number;
      },
    staleTime: 60_000,
  });

  if (isLoading) return <TabSkeleton />;

  const rows = mdmHealth?.data ?? [];

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        MDM Health data will appear after the first sync cycle completes.
      </p>
    );
  }

  const chartData = rows.map((r) => ({
    date: r.snapshot_date?.slice(0, 10) ?? "",
    score: r.mdm_health_score,
    coverage: r.golden_record_coverage_pct,
    confidence: r.avg_match_confidence,
  }));

  const latest = rows[rows.length - 1];

  return (
    <div className="space-y-6">
      <SectionToggle
        sections={[
          { key: "summary", label: "Summary" },
          { key: "trend", label: "Trend Chart" },
          { key: "insights", label: "AI Insights" },
        ]}
        visible={visible}
        onToggle={toggle}
      />

      {/* Summary Cards */}
      {visible.has("summary") && <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Health Score</p>
            <p className="text-2xl font-bold text-foreground">
              {latest.mdm_health_score?.toFixed(1) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Golden Coverage</p>
            <p className="text-2xl font-bold text-primary">
              {latest.golden_record_coverage_pct != null
                ? `${latest.golden_record_coverage_pct.toFixed(1)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Match Confidence</p>
            <p className="text-2xl font-bold text-foreground">
              {latest.avg_match_confidence != null
                ? `${latest.avg_match_confidence.toFixed(1)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08]">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Backlog</p>
            <p className="text-2xl font-bold text-foreground">
              {latest.backlog_count ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>}

      {/* Area Chart */}
      {visible.has("trend") && <Card className="border-black/[0.08]">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-foreground">
            MDM Health Score Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="grad-mdm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0695A8" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0695A8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "rgba(255,255,255,0.40)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "rgba(255,255,255,0.40)" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <RechartsTooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="#0695A8"
                  strokeWidth={2}
                  fill="url(#grad-mdm)"
                  name="Health Score"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>}

      {/* AI Insights panel — only render if ai_narrative exists */}
      {visible.has("insights") && latest.ai_narrative && (
        <Card className="border-black/[0.08]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              AI Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{latest.ai_narrative}</p>
            {latest.ai_projected_score != null && (
              <p className="mt-2 text-xs text-foreground">
                Projected score: <strong>{latest.ai_projected_score.toFixed(1)}</strong>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

function TabSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Predictive, prescriptive, impact, and operational analytics
        </p>
      </div>

      <Tabs defaultValue="predictive">
        <TabsList>
          <TabsTrigger value="predictive">Predictive</TabsTrigger>
          <TabsTrigger value="prescriptive">Prescriptive</TabsTrigger>
          <TabsTrigger value="impact">Impact</TabsTrigger>
          <TabsTrigger value="operational">Operational</TabsTrigger>
          <TabsTrigger value="mdm">MDM Health</TabsTrigger>
        </TabsList>

        <TabsContent value="predictive">
          <PredictiveTab />
        </TabsContent>
        <TabsContent value="prescriptive">
          <PrescriptiveTab />
        </TabsContent>
        <TabsContent value="impact">
          <ImpactTab />
        </TabsContent>
        <TabsContent value="operational">
          <OperationalTab />
        </TabsContent>
        <TabsContent value="mdm">
          <MDMHealthTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
