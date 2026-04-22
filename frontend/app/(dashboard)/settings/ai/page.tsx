"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Brain, Lock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLLMConfig, getLLMProviders } from "@/lib/api/llm-settings";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { getLlmSavingsSummary } from "@/lib/api/llm-savings";

/**
 * /settings/ai — consolidated AI configuration surface.
 *
 * Shows:
 *   - Current provider + data residency status (read-only summary).
 *   - Prominent data-at-rest advisory for ollama_cloud.
 *   - KPI rail pulling from /api/v1/metrics/llm-savings so admins see the
 *     cost impact of their provider choice at a glance.
 *   - Deep-link to /settings?tab=llm for editing the config.
 */
export default function SettingsAIPage() {
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["llm-config"],
    queryFn: getLLMConfig,
    retry: false,
  });
  const { data: providers } = useQuery({
    queryKey: ["llm-providers"],
    queryFn: getLLMProviders,
    retry: false,
  });
  const { data: savings } = useQuery({
    queryKey: ["llm-savings-summary", 30],
    queryFn: () => getLlmSavingsSummary(30),
    retry: false,
  });

  const provider = config?.provider ?? "unknown";
  const providerInfo = providers?.[provider];
  const isCloud = provider === "ollama_cloud";
  const isOnPrem = provider === "ollama" || provider === "custom";

  const kpis: KpiItem[] = savings
    ? [
        {
          label: "Provider",
          value: providerInfo?.label ?? provider,
          hint: isCloud
            ? "Cloud provider — prompts leave the cluster"
            : "On-premise inference",
          tone: isCloud ? "warn" : "pos",
        },
        {
          label: "Reduction",
          value: `${savings.reduction_pct.toFixed(1)}%`,
          tone: savings.reduction_pct >= 30 ? "pos" : "neutral",
        },
        {
          label: "Calls saved",
          value: savings.calls_saved.toLocaleString(),
        },
        {
          label: "Cost saved (30d)",
          value: `$${savings.cost_saved_usd.toFixed(2)}`,
          tone: "pos",
        },
        {
          label: "Deterministic ratio",
          value: `${(savings.deterministic_ratio * 100).toFixed(0)}%`,
          hint: "Share of calls handled without LLM",
        },
        {
          label: "Avg latency",
          value:
            savings.avg_latency_ms !== null
              ? `${Math.round(savings.avg_latency_ms)}ms`
              : "—",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Brain className="h-5 w-5 text-primary" />
            AI settings
          </h1>
          <p className="text-sm text-muted-foreground">
            LLM provider, data residency, and savings — one page.
          </p>
        </div>
        <Link href="/settings?tab=llm">
          <Button size="sm" variant="outline" className="gap-1">
            Edit config
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      {kpis.length > 0 ? <KpiRail items={kpis} columns={6} /> : null}

      {isCloud ? (
        <NarrativeStrip
          headline="Prompts are leaving your cluster."
          detail="ollama_cloud processes requests on shared infrastructure. Switch to ollama or custom (BYOLLM) to keep all inference on-prem."
          tone="warn"
          cta={{ label: "Review data-at-rest advisory", href: "#data-at-rest" }}
        />
      ) : isOnPrem ? (
        <NarrativeStrip
          headline="All LLM inference stays on-premise."
          detail={`Provider: ${providerInfo?.label ?? provider}. No prompt content leaves the cluster.`}
          tone="pos"
          cta={null}
        />
      ) : null}

      {/* Current provider */}
      <div>
        <SectionHeader title="Current provider" caption="Read-only summary" />
        <div className="vx-card mt-2 p-4">
          {configLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : config ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field
                label="Provider"
                value={
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">
                      {providerInfo?.label ?? provider}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        isCloud
                          ? "border-[#D97706]/30 bg-[#D97706]/10 text-[10px] text-[#D97706]"
                          : "border-primary/20 bg-primary/10 text-[10px] text-primary"
                      }
                    >
                      {isCloud ? "Cloud" : "On-prem"}
                    </Badge>
                  </span>
                }
              />
              <Field label="Model" value={config.model || "—"} mono />
              <Field
                label="Source"
                value={config.source === "database" ? "Saved in DB" : "Env vars"}
              />
              <Field
                label="API key"
                value={
                  config.has_api_key ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {config.api_key_preview ?? "•••"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )
                }
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not available. LLM configuration requires admin permission.
            </p>
          )}
        </div>
      </div>

      {/* Data-at-rest advisory */}
      <div id="data-at-rest">
        <SectionHeader
          title="Data residency & at-rest disclosure"
          caption="Where do prompts go once they leave Meridian?"
        />
        <div
          className={`vx-card mt-2 space-y-3 border-l-4 p-4 ${
            isCloud
              ? "border-l-[#D97706] bg-[#D97706]/[0.04]"
              : "border-l-primary bg-primary/[0.03]"
          }`}
        >
          <div className="flex items-start gap-2">
            {isCloud ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#D97706]" />
            ) : (
              <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
            )}
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-foreground">
                {isCloud
                  ? "Data leaves your cluster when provider = ollama_cloud"
                  : "All prompts stay on-premise"}
              </p>
              <p className="text-muted-foreground">
                When <span className="mx-0.5 rounded bg-black/[0.05] px-1 py-0.5 font-mono text-xs">ollama_cloud</span> is the
                selected provider, prompts — <strong>aggregated findings only, never raw
                SAP rows</strong> — leave your cluster and are processed on Ollama Cloud
                infrastructure. Responses are returned and discarded; <strong>no prompt
                content is stored outside your cluster</strong>.
              </p>
              <p className="text-muted-foreground">
                Switch to{" "}
                <span className="mx-0.5 rounded bg-black/[0.05] px-1 py-0.5 font-mono text-xs">
                  ollama
                </span>{" "}
                (local) or{" "}
                <span className="mx-0.5 rounded bg-black/[0.05] px-1 py-0.5 font-mono text-xs">
                  custom
                </span>{" "}
                (BYOLLM) to keep all inference strictly on-premise.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <Advisory
              icon={<Lock className="h-3.5 w-3.5 text-primary" />}
              title="Payloads"
              body="Aggregated findings only. Raw SAP records are never included."
            />
            <Advisory
              icon={<ShieldCheck className="h-3.5 w-3.5 text-primary" />}
              title="Storage"
              body="Responses are consumed and discarded. Nothing stored outside your cluster."
            />
            <Advisory
              icon={<AlertTriangle className="h-3.5 w-3.5 text-[#D97706]" />}
              title="Egress"
              body="Cloud providers imply network egress. Review your data-governance policy."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`font-medium text-foreground ${mono ? "font-mono text-xs" : "text-sm"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Advisory({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-black/[0.06] bg-white/[0.60] p-2.5">
      {icon}
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
