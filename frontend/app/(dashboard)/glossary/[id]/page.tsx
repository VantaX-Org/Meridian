"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, BookOpen, Lock, Sparkles, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Save, RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getGlossaryTerm,
  requestAIDraft,
  updateGlossaryTerm,
  reviewGlossaryTerm,
} from "@/lib/api/glossary";
import { formatModuleName, severityColor, passRateColor } from "@/lib/format";
import type { GlossaryTermDetail, AIDraftResponse } from "@/types/api";
import Link from "next/link";

function domainColor(domain: string): string {
  const colors: Record<string, string> = {
    business_partner: "bg-primary/10 text-primary",
    material_master: "bg-[#2563EB]/10 text-[#2563EB]",
    fi_gl: "bg-[#D97706]/10 text-[#EA580C]",
    employee_central: "bg-[#7C3AED]/10 text-[#7C3AED]",
  };
  return colors[domain] || "bg-white/[0.60] text-muted-foreground";
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/20">{status}</Badge>;
    case "under_review":
      return <Badge className="bg-[#D97706]/10 text-[#EA580C] border border-[#D97706]/20">under review</Badge>;
    case "deprecated":
      return <Badge className="bg-[#DC2626]/10 text-destructive border border-[#DC2626]/20">{status}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}

export default function GlossaryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: term, isLoading } = useQuery<GlossaryTermDetail>({
    queryKey: ["glossary", id],
    queryFn: () => getGlossaryTerm(id),
  });

  const [editDef, setEditDef] = useState<string | null>(null);
  const [draftModal, setDraftModal] = useState(false);
  const [draft, setDraft] = useState<AIDraftResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateGlossaryTerm>[1]) =>
      updateGlossaryTerm(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["glossary", id] });
      setEditDef(null);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () => reviewGlossaryTerm(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["glossary", id] }),
  });

  const handleAIDraft = async () => {
    setDraftLoading(true);
    try {
      const result = await requestAIDraft(id);
      setDraft(result);
      setDraftModal(true);
    } catch {
      // Error handled by axios interceptor
    } finally {
      setDraftLoading(false);
    }
  };

  const acceptDraft = () => {
    if (draft) {
      setEditDef(draft.business_definition);
      setDraftModal(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!term) {
    return <div className="text-muted-foreground">Glossary term not found.</div>;
  }

  const reviewDays = daysSince(term.last_reviewed_at);
  const reviewEnabled = reviewDays === null || reviewDays >= term.review_cycle_days;
  const currentDef = editDef ?? term.business_definition ?? "";

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/glossary"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary/80"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Glossary
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            {term.business_name}
            {term.mandatory_for_s4hana && <Lock className="h-5 w-5 text-destructive" />}
          </h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">{term.technical_name}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge className={domainColor(term.domain)}>{formatModuleName(term.domain)}</Badge>
            {statusBadge(term.status)}
            {term.ai_drafted && (
              <Badge className="bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
                <Sparkles className="h-3 w-3 mr-0.5" /> AI Drafted
              </Badge>
            )}
            {term.rule_authority && (
              <Badge variant="outline" className="text-xs">{term.rule_authority}</Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!reviewEnabled || reviewMutation.isPending}
            onClick={() => reviewMutation.mutate()}
          >
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {reviewMutation.isPending ? "Reviewing..." : "Mark Reviewed"}
          </Button>
        </div>
      </div>

      {/* Business Definition */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            Business Definition
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAIDraft}
                disabled={draftLoading}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {draftLoading ? "Drafting..." : "AI Draft"}
              </Button>
              {editDef !== null && editDef !== (term.business_definition ?? "") && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditDef(null)}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Discard
                  </Button>
                  <Button
                    size="sm"
                    className="bg-primary hover:bg-primary/80"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate({ business_definition: editDef })}
                  >
                    <Save className="h-3.5 w-3.5 mr-1" />
                    {saveMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="w-full min-h-[80px] p-3 border border-black/[0.08] rounded-md text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                       resize-y"
            value={currentDef}
            onChange={(e) => setEditDef(e.target.value)}
            placeholder="No business definition yet. Click 'AI Draft' to generate one."
          />
          {term.why_it_matters && (
            <div className="mt-3 p-3 bg-white/[0.60] rounded-md">
              <span className="text-xs font-medium text-muted-foreground uppercase">Why it matters</span>
              <p className="text-sm text-foreground mt-1">{term.why_it_matters}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SAP Impact */}
      {term.sap_impact && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">SAP Impact</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground">{term.sap_impact}</p>
          </CardContent>
        </Card>
      )}

      {/* Approved Values */}
      {term.approved_values && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Approved Values</CardTitle>
          </CardHeader>
          <CardContent>
            {Array.isArray(term.approved_values) ? (
              <div className="flex flex-wrap gap-1.5">
                {term.approved_values.map((val) => (
                  <Badge key={val} variant="outline" className="font-mono text-xs">{val}</Badge>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Label</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(term.approved_values).map(([code, label]) => (
                    <TableRow key={code}>
                      <TableCell className="font-mono text-xs">{code}</TableCell>
                      <TableCell className="text-sm">{label}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Linked Rules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Linked Rules ({term.linked_rules.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {term.linked_rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules linked to this term.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule ID</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Pass Rate</TableHead>
                  <TableHead className="text-right">Affected / Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {term.linked_rules.map((rule) => (
                  <TableRow key={rule.rule_id}>
                    <TableCell className="font-mono text-xs">{rule.rule_id}</TableCell>
                    <TableCell>{formatModuleName(rule.domain)}</TableCell>
                    <TableCell>
                      {rule.severity && (
                        <Badge className={severityColor(rule.severity)}>{rule.severity}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {rule.pass_rate !== null ? (
                        <div className="flex items-center gap-2">
                          <Progress
                            value={rule.pass_rate * 100}
                            className="h-2 w-20"
                          />
                          <span className={`text-xs ${passRateColor(rule.pass_rate)}`}>
                            {(rule.pass_rate * 100).toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No data</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {rule.affected_count !== null && rule.total_count !== null
                        ? `${rule.affected_count} / ${rule.total_count}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Change History */}
      <Card>
        <CardHeader
          className="pb-2 cursor-pointer"
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          <CardTitle className="text-base flex items-center justify-between">
            Change History ({term.change_history.length})
            {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardTitle>
        </CardHeader>
        {historyOpen && (
          <CardContent>
            {term.change_history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded.</p>
            ) : (
              <div className="space-y-3">
                {term.change_history.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 border-l-2 border-black/[0.08] pl-3">
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{entry.field_changed}</span>
                        <span className="text-xs text-muted-foreground">
                          by {entry.changed_by} &middot;{" "}
                          {new Date(entry.changed_at).toLocaleDateString()}
                        </span>
                      </div>
                      {entry.old_value && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          From: <span className="line-through">{entry.old_value.substring(0, 100)}</span>
                        </div>
                      )}
                      {entry.new_value && (
                        <div className="text-xs text-foreground mt-0.5">
                          To: {entry.new_value.substring(0, 200)}
                        </div>
                      )}
                      {entry.change_reason && (
                        <div className="text-xs text-muted-foreground mt-0.5 italic">{entry.change_reason}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Review info */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Review cycle: every {term.review_cycle_days} days
          {reviewDays !== null && (
            <> &middot; Last reviewed {reviewDays} day{reviewDays !== 1 ? "s" : ""} ago</>
          )}
          {reviewDays === null && <> &middot; Never reviewed</>}
        </div>
        {term.data_steward_id && (
          <div>Steward: {term.data_steward_id}</div>
        )}
      </div>

      {/* AI Draft Modal */}
      <Dialog open={draftModal} onOpenChange={setDraftModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#7C3AED]" />
              AI Draft
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase">Business Definition</span>
                <p className="text-sm text-foreground mt-1 p-3 bg-white/[0.60] rounded-md">
                  {draft.business_definition}
                </p>
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase">Why It Matters</span>
                <p className="text-sm text-foreground mt-1 p-3 bg-white/[0.60] rounded-md">
                  {draft.why_it_matters_business}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraftModal(false)}>
                  Discard
                </Button>
                <Button
                  className="bg-primary hover:bg-primary/80"
                  onClick={acceptDraft}
                >
                  Accept Draft
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
