"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Crown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Send,
  Clock,
  Brain,
  History,
  ChevronDown,
  ChevronUp,
  GitBranch,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMasterRecord,
  getMasterRecordHistory,
  promoteMasterRecord,
  writebackMasterRecord,
} from "@/lib/api/master-records";
import { batchLookupGlossary } from "@/lib/api/glossary";
import { getRelationships } from "@/lib/api/relationships";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatModuleName, relativeTime } from "@/lib/format";
import type {
  MasterRecordDetail,
  MasterRecordHistoryEntry,
  SourceContribution,
  RecordRelationship,
} from "@/types/api";

function ConfidenceBar({
  confidence,
  size = "md",
}: {
  confidence: number;
  size?: "sm" | "md";
}) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? "bg-[#16A34A]" : pct >= 60 ? "bg-[#EA580C]" : "bg-destructive";
  const height = size === "sm" ? "h-1" : "h-2";
  const width = size === "sm" ? "w-16" : "w-24";
  return (
    <div className="flex items-center gap-2">
      <div className={`${height} ${width} rounded-full bg-white/[0.60]`}>
        <div
          className={`${height} rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-foreground">{pct}%</span>
    </div>
  );
}

function FieldRow({
  fieldName,
  goldenValue,
  contribution,
  showAi,
  businessName,
}: {
  fieldName: string;
  goldenValue: unknown;
  contribution: SourceContribution | undefined;
  showAi: boolean;
  businessName?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAi = showAi && contribution?.ai_recommendation;

  return (
    <div className="border-b border-black/[0.06] last:border-0">
      <div
        className={`flex items-center justify-between px-4 py-3 ${hasAi ? "cursor-pointer hover:bg-black/[0.03]" : ""}`}
        onClick={() => hasAi && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {hasAi && (
            expanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-[#EA580C]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[#EA580C]" />
            )
          )}
          <div>
            <span className="text-sm font-medium text-foreground">
              {businessName || fieldName}
            </span>
            {businessName && (
              <span className="block text-xs font-mono text-muted-foreground">{fieldName}</span>
            )}
            <p className="text-xs text-muted-foreground">
              {contribution
                ? `From ${contribution.source_system} · ${relativeTime(contribution.extracted_at)}`
                : "No source"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-foreground">
            {String(goldenValue ?? "—")}
          </span>
          {contribution && (
            <ConfidenceBar confidence={contribution.confidence} size="sm" />
          )}
          {hasAi && (
            <Badge
              variant="outline"
              className="gap-1 bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20 text-xs"
            >
              <Brain className="h-3 w-3" />
              AI
            </Badge>
          )}
        </div>
      </div>

      {/* AI recommendation panel */}
      {expanded && hasAi && contribution && (
        <div className="mx-4 mb-3 rounded-lg border border-[#EA580C]/20 bg-[#EA580C]/5 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-[#EA580C]">
            <Brain className="h-3.5 w-3.5" />
            AI Recommendation
          </div>
          <div className="mt-2 space-y-1 text-xs text-foreground">
            <p>
              <span className="text-muted-foreground">Recommended source:</span>{" "}
              {contribution.ai_recommendation}
            </p>
            <p>
              <span className="text-muted-foreground">AI confidence:</span>{" "}
              {Math.round((contribution.ai_confidence ?? 0) * 100)}%
            </p>
            {contribution.ai_reasoning && (
              <p>
                <span className="text-muted-foreground">Reasoning:</span>{" "}
                {contribution.ai_reasoning}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ recordId }: { recordId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["master-record-history", recordId],
    queryFn: () => getMasterRecordHistory(recordId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No history entries
      </p>
    );
  }

  const changeTypeLabels: Record<string, string> = {
    created: "Record created",
    updated: "Fields updated",
    promoted: "Promoted to golden",
  };

  return (
    <div className="space-y-2">
      {history.map((entry: MasterRecordHistoryEntry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 rounded-lg border border-black/[0.06] px-3 py-2"
        >
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.60]">
            {entry.change_type === "promoted" ? (
              <Crown className="h-3 w-3 text-[#16A34A]" />
            ) : (
              <Clock className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {changeTypeLabels[entry.change_type] ?? entry.change_type}
              </span>
              {entry.ai_was_involved && (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20"
                >
                  <Brain className="h-2.5 w-2.5" />
                  AI involved
                </Badge>
              )}
              {entry.ai_recommendation_accepted !== null && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    entry.ai_recommendation_accepted
                      ? "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20"
                      : "bg-destructive/10 text-destructive border-destructive/20"
                  }`}
                >
                  AI {entry.ai_recommendation_accepted ? "accepted" : "rejected"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {relativeTime(entry.changed_at)}
              {entry.changed_by && ` · by ${entry.changed_by}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RelationshipsPanel({
  domain,
  objectKey,
}: {
  domain: string;
  objectKey: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["relationships", domain, objectKey],
    queryFn: () => getRelationships({ domain, key: objectKey }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const relationships = data?.relationships ?? [];

  if (relationships.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No cross-domain relationships found
      </p>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {relationships.map((rel: RecordRelationship) => {
          // Show the "other" side of the relationship
          const isFrom = rel.from_domain === domain && rel.from_key === objectKey;
          const otherDomain = isFrom ? rel.to_domain : rel.from_domain;
          const otherKey = isFrom ? rel.to_key : rel.from_key;
          const impactPct = rel.impact_score != null ? Math.round(rel.impact_score * 100) : null;

          return (
            <div
              key={rel.id}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                rel.ai_inferred
                  ? "border-dashed border-[#3B82F6]/30 bg-[#2563EB]/5"
                  : "border-black/[0.06]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2563EB]/10">
                  <GitBranch className="h-4 w-4 text-[#2563EB]" />
                </div>
                <div>
                  <Link
                    href={`/golden-records?domain=${otherDomain}`}
                    className="text-sm font-medium text-foreground hover:text-primary/80"
                  >
                    {formatModuleName(otherDomain)} / {otherKey}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {rel.relationship_type.replace(/_/g, " ")}
                    {rel.sap_link_table && ` · via ${rel.sap_link_table}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {impactPct !== null && (
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-12 rounded-full bg-white/[0.60]">
                      <div
                        className={`h-1.5 rounded-full ${
                          impactPct >= 70
                            ? "bg-destructive"
                            : impactPct >= 40
                              ? "bg-[#EA580C]"
                              : "bg-[#16A34A]"
                        }`}
                        style={{ width: `${impactPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-foreground">
                      {impactPct}%
                    </span>
                  </div>
                )}
                {rel.ai_inferred && (
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge
                        variant="outline"
                        className="gap-1 bg-[#2563EB]/10 text-[#2563EB] border-[#3B82F6]/20 text-xs"
                      >
                        <Brain className="h-2.5 w-2.5" />
                        Probable
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Probable — not confirmed in SAP
                        {rel.ai_confidence != null &&
                          ` (${Math.round(rel.ai_confidence * 100)}% confidence)`}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export default function GoldenRecordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const recordId = params.id as string;
  const [showHistory, setShowHistory] = useState(false);
  const [showRelationships, setShowRelationships] = useState(false);

  const { data: record, isLoading } = useQuery({
    queryKey: ["master-record", recordId],
    queryFn: () => getMasterRecord(recordId),
  });

  // Glossary lookup for field business names
  const fieldKeys = record ? Object.keys(record.golden_fields) : [];
  const { data: glossaryLookup } = useQuery({
    queryKey: ["glossary-lookup", fieldKeys],
    queryFn: () => batchLookupGlossary(fieldKeys),
    enabled: fieldKeys.length > 0,
    staleTime: 5 * 60_000,
  });

  const promoteMutation = useMutation({
    mutationFn: () => promoteMasterRecord(recordId, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["master-record", recordId] });
      qc.invalidateQueries({ queryKey: ["master-records"] });
    },
  });

  const writebackMutation = useMutation({
    mutationFn: () => writebackMasterRecord(recordId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Record not found</p>
      </div>
    );
  }

  const fieldNames = Object.keys(record.golden_fields);
  const contributions = record.source_contributions as Record<
    string,
    SourceContribution
  >;

  // Check if any field has AI recommendation
  const hasAiFields = Object.values(contributions).some(
    (c) => c && typeof c === "object" && "ai_recommendation" in c
  );

  // Unique source systems
  const sources = new Set<string>();
  Object.values(contributions).forEach((c) => {
    if (c && typeof c === "object" && "source_system" in c) {
      sources.add(c.source_system);
    }
  });

  const statusClasses: Record<string, string> = {
    candidate: "bg-primary/10 text-primary border-primary/20",
    pending_review: "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20",
    golden: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
    superseded: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20",
  };

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Link
        href="/golden-records"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary/80"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Golden Records
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-xl font-bold text-foreground">
              {record.sap_object_key}
            </h1>
            <Badge
              variant="outline"
              className={`gap-1 ${statusClasses[record.status] ?? ""}`}
            >
              {record.status === "golden" && <Crown className="h-3 w-3" />}
              {record.status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatModuleName(record.domain)} &middot; {sources.size} source
            system{sources.size !== 1 ? "s" : ""}: {Array.from(sources).join(", ")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {record.status !== "golden" && record.status !== "superseded" && (
            <Button
              onClick={() => promoteMutation.mutate()}
              disabled={promoteMutation.isPending}
              className="gap-2 bg-[#16A34A] hover:bg-[#16A34A]/80 text-white"
            >
              {promoteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crown className="h-4 w-4" />
              )}
              Promote to Golden
            </Button>
          )}
          {record.status === "golden" && (
            <Button
              onClick={() => writebackMutation.mutate()}
              disabled={writebackMutation.isPending}
              variant="outline"
              className="gap-2 border-primary text-primary hover:bg-primary/5"
            >
              {writebackMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Write Back to SAP
            </Button>
          )}
        </div>
      </div>

      {/* Confidence overview */}
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Overall Confidence
              </p>
              <p className="text-3xl font-bold text-foreground">
                {Math.round(record.overall_confidence * 100)}%
              </p>
            </div>
            <ConfidenceBar confidence={record.overall_confidence} />
          </div>
          {record.promoted_at && (
            <p className="mt-2 text-xs text-muted-foreground">
              Promoted {relativeTime(record.promoted_at)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Writeback success message */}
      {writebackMutation.isSuccess && writebackMutation.data && (
        <Card className="border-[#16A34A]/20 bg-[#16A34A]/5">
          <CardContent className="p-4 text-sm text-[#16A34A]">
            <CheckCircle2 className="mb-1 inline h-4 w-4" />{" "}
            {writebackMutation.data.message}
          </CardContent>
        </Card>
      )}

      {/* Field-level detail */}
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Field Values ({fieldNames.length})
            </h2>
            {hasAiFields && (
              <div className="flex items-center gap-1 text-xs text-[#EA580C]">
                <Brain className="h-3.5 w-3.5" />
                AI recommendations available — click to expand
              </div>
            )}
          </div>
          {fieldNames.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No fields yet
            </p>
          ) : (
            fieldNames.map((field) => (
              <FieldRow
                key={field}
                fieldName={field}
                goldenValue={record.golden_fields[field]}
                contribution={contributions[field]}
                showAi={hasAiFields}
                businessName={glossaryLookup?.lookup?.[field]?.business_name}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Relationships tab */}
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="p-0">
          <button
            onClick={() => setShowRelationships(!showRelationships)}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-black/[0.03]"
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-[#2563EB]" />
              <span className="text-sm font-semibold text-foreground">
                Relationships
              </span>
            </div>
            {showRelationships ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showRelationships && (
            <div className="border-t border-black/[0.06] px-4 py-3">
              <RelationshipsPanel
                domain={record.domain}
                objectKey={record.sap_object_key}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* History toggle */}
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="p-0">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-black/[0.03]"
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">
                Audit History
              </span>
            </div>
            {showHistory ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showHistory && (
            <div className="border-t border-black/[0.06] px-4 py-3">
              <HistoryPanel recordId={recordId} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
