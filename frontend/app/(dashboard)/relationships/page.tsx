"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network, Sparkles, Filter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getRelationships, getRelationshipTypes } from "@/lib/api/relationships";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { RecordRelationship, RelationshipTypeRef } from "@/types/api";

function confidenceColor(score: number | null): string {
  if (score == null) return "bg-white/[0.60] text-muted-foreground";
  if (score >= 0.8) return "bg-[#16A34A]/10 text-[#16A34A]";
  if (score >= 0.5) return "bg-[#D97706]/10 text-[#EA580C]";
  return "bg-[#DC2626]/10 text-destructive";
}

function impactBadge(score: number | null): string {
  if (score == null) return "bg-white/[0.60] text-muted-foreground";
  if (score >= 0.8) return "bg-[#DC2626]/10 text-destructive";
  if (score >= 0.5) return "bg-[#D97706]/10 text-[#EA580C]";
  return "bg-[#16A34A]/10 text-[#16A34A]";
}

export default function RelationshipsPage() {
  const [domainFilter, setDomainFilter] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["relationships", domainFilter],
    queryFn: () =>
      getRelationships(domainFilter ? { domain: domainFilter } : undefined),
  });

  const { data: types } = useQuery({
    queryKey: ["relationship-types"],
    queryFn: getRelationshipTypes,
  });

  const relationships = data?.relationships ?? [];

  // Build unique domain list from relationship types
  const domains = useMemo(() => {
    if (!types) return [];
    const set = new Set<string>();
    types.forEach((t: RelationshipTypeRef) => {
      set.add(t.from_table);
      set.add(t.to_table);
    });
    return Array.from(set).sort();
  }, [types]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">
            Relationships
          </h1>
          <p className="text-sm text-muted-foreground">
            Cross-domain SAP record relationships and dependency graph
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {formatModuleName(d)}
            </option>
          ))}
        </select>
        {domainFilter && (
          <button
            onClick={() => setDomainFilter("")}
            className="text-xs text-primary hover:underline"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {data ? `${data.total} relationship${data.total !== 1 ? "s" : ""}` : ""}
        </span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : relationships.length === 0 ? (
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Network className="h-12 w-12 text-white/[0.08]" />
            <h3 className="mt-4 font-semibold text-foreground">
              No relationships found
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {domainFilter
                ? "No relationships match the selected domain filter."
                : "Relationships are discovered during SAP sync and analysis runs."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.08] text-left text-muted-foreground">
                    <th className="px-4 py-3">From</th>
                    <th className="px-4 py-3">To</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Impact</th>
                    <th className="px-4 py-3">Discovered</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r: RecordRelationship) => (
                    <tr
                      key={r.id}
                      className="border-b border-black/[0.08]/50 hover:bg-black/[0.03]"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          {formatModuleName(r.from_domain)}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.from_key}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          {formatModuleName(r.to_domain)}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.to_key}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-foreground">
                          {r.relationship_type.replace(/_/g, " ")}
                        </span>
                        {r.ai_inferred && (
                          <Badge className="ml-2 gap-1 bg-primary/10 text-primary border border-primary/20">
                            <Sparkles className="h-3 w-3" />
                            AI
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.ai_confidence != null ? (
                          <Badge className={confidenceColor(r.ai_confidence)}>
                            {(r.ai_confidence * 100).toFixed(0)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.impact_score != null ? (
                          <Badge className={impactBadge(r.impact_score)}>
                            {(r.impact_score * 100).toFixed(0)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {relativeTime(r.discovered_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            r.active
                              ? "bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/20"
                              : "bg-white/[0.60] text-muted-foreground border border-black/[0.08]"
                          }
                        >
                          {r.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
