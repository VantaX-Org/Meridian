"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Lock, ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { formatModuleName } from "@/lib/format";
import type { GlossaryTermSummary, GlossaryListResponse } from "@/types/api";

const PAGE_SIZE = 50;

const DOMAINS = [
  "business_partner",
  "material_master",
  "fi_gl",
  "accounts_payable",
  "accounts_receivable",
  "asset_accounting",
  "mm_purchasing",
  "plant_maintenance",
  "production_planning",
  "sd_customer_master",
  "sd_sales_orders",
  "employee_central",
  "compensation",
  "payroll_integration",
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "under_review", label: "Under Review" },
  { value: "deprecated", label: "Deprecated" },
];

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
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function GlossaryPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [mandatoryOnly, setMandatoryOnly] = useState(false);
  const [aiDraftedOnly, setAiDraftedOnly] = useState(false);

  const { data, isLoading } = useQuery<GlossaryListResponse>({
    queryKey: ["glossary", page, search, domain, status, mandatoryOnly, aiDraftedOnly],
    queryFn: () =>
      getGlossaryTerms({
        page,
        per_page: PAGE_SIZE,
        search: search || undefined,
        domain: domain || undefined,
        status: status || undefined,
        mandatory_for_s4hana: mandatoryOnly || undefined,
        ai_drafted: aiDraftedOnly || undefined,
      }),
  });

  const terms = data?.terms ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          Business Glossary
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          SAP field definitions translated into business language. {total} terms.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search fields, tables, names..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 border border-black/[0.08] rounded-md text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <select
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setPage(1); }}
          className="border border-black/[0.08] rounded-md px-3 py-2 text-sm bg-white/[0.70]"
        >
          <option value="">All Domains</option>
          {DOMAINS.map((d) => (
            <option key={d} value={d}>{formatModuleName(d)}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-black/[0.08] rounded-md px-3 py-2 text-sm bg-white/[0.70]"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <Button
          variant={mandatoryOnly ? "default" : "outline"}
          size="sm"
          onClick={() => { setMandatoryOnly(!mandatoryOnly); setPage(1); }}
          className={mandatoryOnly ? "bg-primary hover:bg-primary/80" : ""}
        >
          <Lock className="h-3 w-3 mr-1" />
          S/4HANA Mandatory
        </Button>

        <Button
          variant={aiDraftedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => { setAiDraftedOnly(!aiDraftedOnly); setPage(1); }}
          className={aiDraftedOnly ? "bg-primary hover:bg-primary/80" : ""}
        >
          <Sparkles className="h-3 w-3 mr-1" />
          AI Drafted
        </Button>
      </div>

      {/* Term list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : terms.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No glossary terms found. Run the seed script to populate from YAML rules.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {terms.map((term) => (
            <TermCard key={term.id} term={term} onClick={() => router.push(`/glossary/${term.id}`)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} terms)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TermCard({ term, onClick }: { term: GlossaryTermSummary; onClick: () => void }) {
  const reviewDays = daysSince(term.last_reviewed_at);
  const overdue = reviewDays !== null && reviewDays > term.review_cycle_days;

  return (
    <Card
      className="cursor-pointer hover:border-primary/30 hover:bg-black/[0.03] transition-colors"
      onClick={onClick}
    >
      <CardContent className="py-3 px-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">{term.business_name}</span>
            {term.mandatory_for_s4hana && (
              <Lock className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{term.technical_name}</div>
        </div>

        <Badge className={`${domainColor(term.domain)} text-xs`}>
          {formatModuleName(term.domain)}
        </Badge>

        {statusBadge(term.status)}

        {term.ai_drafted && (
          <Badge className="bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20 text-xs">
            <Sparkles className="h-3 w-3 mr-0.5" />
            AI
          </Badge>
        )}

        <Badge variant="outline" className="text-xs">
          {term.linked_rules_count} rule{term.linked_rules_count !== 1 ? "s" : ""}
        </Badge>

        {reviewDays !== null ? (
          <span className={`text-xs whitespace-nowrap ${overdue ? "text-[#EA580C] font-medium" : "text-muted-foreground"}`}>
            {reviewDays}d since review
          </span>
        ) : (
          <span className="text-xs text-muted-foreground whitespace-nowrap">Not reviewed</span>
        )}
      </CardContent>
    </Card>
  );
}
