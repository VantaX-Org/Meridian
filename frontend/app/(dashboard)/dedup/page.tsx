"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitMerge, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getDedupCandidates,
  getDedupPreview,
  mergeDedupCandidate,
  type DedupCandidate,
} from "@/lib/api/cleaning";
import { toast } from "sonner";

function scoreColor(score: number): string {
  if (score >= 85) return "bg-[#16A34A]/15 text-[#16A34A] border border-[#16A34A]/30";
  if (score >= 60) return "bg-[#D97706]/15 text-[#D97706] border border-[#D97706]/30";
  return "bg-[#DC2626]/15 text-[#DC2626] border border-[#DC2626]/30";
}

function methodTag(method: string): string {
  switch (method) {
    case "exact": return "bg-[#16A34A]/15 text-[#16A34A]";
    case "fuzzy": return "bg-[#2563EB]/15 text-[#2563EB]";
    case "phonetic": return "bg-[#7C3AED]/15 text-[#7C3AED]";
    case "token_overlap": return "bg-[#D97706]/15 text-[#D97706]";
    default: return "bg-white/[0.60] text-muted-foreground";
  }
}

export default function DedupPage() {
  const queryClient = useQueryClient();
  const [objectType, setObjectType] = useState("business_partner");
  const [minScore, setMinScore] = useState(60);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedCandidate, setSelectedCandidate] = useState<DedupCandidate | null>(null);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, string>>({});

  const { data: candidatesData, isLoading } = useQuery({
    queryKey: ["dedup-candidates", objectType, minScore, statusFilter],
    queryFn: () => getDedupCandidates({ object_type: objectType, min_score: minScore, status: statusFilter }),
  });

  const { data: previewData, isLoading: isPreviewLoading } = useQuery({
    queryKey: ["dedup-preview", selectedCandidate?.record_key_a, selectedCandidate?.record_key_b],
    queryFn: () =>
      getDedupPreview({
        record_key_a: selectedCandidate!.record_key_a,
        record_key_b: selectedCandidate!.record_key_b,
        object_type: selectedCandidate!.object_type,
      }),
    enabled: !!selectedCandidate,
  });

  const mergeMut = useMutation({
    mutationFn: () =>
      mergeDedupCandidate({
        candidate_id: selectedCandidate!.id,
        survivor_key: selectedCandidate!.record_key_a,
        field_overrides: Object.keys(fieldOverrides).length > 0 ? fieldOverrides : undefined,
      }),
    onSuccess: () => {
      toast.success("Records merged successfully");
      setSelectedCandidate(null);
      setFieldOverrides({});
      queryClient.invalidateQueries({ queryKey: ["dedup-candidates"] });
    },
  });

  const candidates = candidatesData?.items ?? [];
  const preview = previewData?.merge_preview;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Deduplication</h1>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <select
            value={objectType}
            onChange={(e) => setObjectType(e.target.value)}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="business_partner">Business Partner</option>
            <option value="material">Material</option>
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
            <option value="employee">Employee</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="merged">Merged</option>
            <option value="dismissed">Dismissed</option>
          </select>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Min Score:</span>
            <input
              type="range"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-xs font-medium">{minScore}%</span>
          </div>

          <span className="ml-auto text-xs text-muted-foreground">
            {candidates.length} candidates
          </span>
        </CardContent>
      </Card>

      {/* Candidate list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3">Match Score</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Record A</th>
                    <th className="px-4 py-3">Record B</th>
                    <th className="px-4 py-3">Object Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-black/[0.04] hover:bg-black/[0.03] cursor-pointer"
                      onClick={() => setSelectedCandidate(c)}
                    >
                      <td className="px-4 py-3">
                        <Badge className={scoreColor(c.match_score)}>
                          {c.match_score}%
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={methodTag(c.match_method)}>
                          {c.match_method}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{c.record_key_a}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.record_key_b}</td>
                      <td className="px-4 py-3">{c.object_type}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedCandidate(c); }}>
                          <GitMerge className="mr-1 h-3.5 w-3.5" /> Merge
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {candidates.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No dedup candidates found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Merge Preview Modal */}
      <Dialog
        open={!!selectedCandidate}
        onOpenChange={(open) => { if (!open) { setSelectedCandidate(null); setFieldOverrides({}); } }}
      >
        <DialogContent className="max-w-[900px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5 text-primary" />
              Merge Preview
            </DialogTitle>
          </DialogHeader>

          {isPreviewLoading || !preview ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select which value to keep for each field. Click a value to choose it as the survivor.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-2">Field</th>
                      <th className="py-2 pr-2">
                        Record A <span className="font-mono text-xs">({selectedCandidate?.record_key_a})</span>
                      </th>
                      <th className="py-2 pr-2">
                        Record B <span className="font-mono text-xs">({selectedCandidate?.record_key_b})</span>
                      </th>
                      <th className="py-2">Survivor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(preview).map(([field, vals]) => {
                      const v = vals as { a: string; b: string; survivor: string };
                      const override = fieldOverrides[field];
                      const currentSurvivor = override ?? v.survivor;

                      return (
                        <tr key={field} className="border-b border-border/30">
                          <td className="py-2 pr-2 font-mono text-xs text-muted-foreground">{field}</td>
                          <td className="py-2 pr-2">
                            <button
                              className={`rounded px-2 py-1 text-left text-xs transition-colors ${
                                currentSurvivor === v.a
                                  ? "bg-primary/10 ring-1 ring-primary"
                                  : "hover:bg-accent"
                              }`}
                              onClick={() => setFieldOverrides((prev) => ({ ...prev, [field]: v.a }))}
                            >
                              {v.a || "—"}
                            </button>
                          </td>
                          <td className="py-2 pr-2">
                            <button
                              className={`rounded px-2 py-1 text-left text-xs transition-colors ${
                                currentSurvivor === v.b
                                  ? "bg-primary/10 ring-1 ring-primary"
                                  : "hover:bg-accent"
                              }`}
                              onClick={() => setFieldOverrides((prev) => ({ ...prev, [field]: v.b }))}
                            >
                              {v.b || "—"}
                            </button>
                          </td>
                          <td className="py-2 font-medium text-primary text-xs">
                            {currentSurvivor || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { setSelectedCandidate(null); setFieldOverrides({}); }}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-primary hover:bg-primary/90 text-white"
                  onClick={() => mergeMut.mutate()}
                  disabled={mergeMut.isPending}
                >
                  <GitMerge className="mr-1 h-4 w-4" />
                  {mergeMut.isPending ? "Merging..." : "Merge Records"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
