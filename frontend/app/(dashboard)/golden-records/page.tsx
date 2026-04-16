"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Crown,
  Filter,
  Loader2,
  ChevronRight,
  Database,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { getMasterRecords } from "@/lib/api/master-records";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { MasterRecordSummary, MasterRecordStatus } from "@/types/api";

const STATUS_CONFIG: Record<
  MasterRecordStatus,
  { label: string; icon: React.ReactNode; classes: string }
> = {
  candidate: {
    label: "Candidate",
    icon: <Clock className="h-3.5 w-3.5" />,
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  pending_review: {
    label: "Pending Review",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    classes: "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20",
  },
  golden: {
    label: "Golden",
    icon: <Crown className="h-3.5 w-3.5" />,
    classes: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
  },
  superseded: {
    label: "Superseded",
    icon: <XCircle className="h-3.5 w-3.5" />,
    classes: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20",
  },
};

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? "bg-[#16A34A]" : pct >= 60 ? "bg-[#EA580C]" : "bg-destructive";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-white/[0.60]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-foreground">{pct}%</span>
    </div>
  );
}

const FALLBACK_STATUS = {
  label: "Unknown",
  icon: <Clock className="h-3.5 w-3.5" />,
  classes: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20",
};

function RecordRow({ record }: { record: MasterRecordSummary }) {
  const statusConfig = STATUS_CONFIG[record.status] ?? FALLBACK_STATUS;

  return (
    <Link href={`/golden-records/${record.id}`}>
      <div className="flex items-center justify-between rounded-lg border border-black/[0.08] bg-white/[0.70] px-4 py-3 transition-colors hover:border-primary/30 hover:bg-black/[0.03]">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.65]">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {record.sap_object_key}
              </span>
              <Badge
                variant="outline"
                className={`text-xs gap-1 ${statusConfig.classes}`}
              >
                {statusConfig.icon}
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatModuleName(record.domain)} &middot;{" "}
              {record.source_count} source{record.source_count !== 1 ? "s" : ""}{" "}
              &middot; Updated {relativeTime(record.updated_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {record.pending_issues > 0 && (
            <div className="flex items-center gap-1 text-xs text-[#EA580C]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {record.pending_issues} AI conflict{record.pending_issues !== 1 ? "s" : ""}
            </div>
          )}
          <ConfidenceBar confidence={record.overall_confidence} />
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}

export default function GoldenRecordsPage() {
  const [domain, setDomain] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["master-records", domain, status, page],
    queryFn: () =>
      getMasterRecords({
        domain: domain || undefined,
        status: status || undefined,
        page,
        per_page: 20,
      }),
  });

  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  // Stats from current page data
  const goldenCount = records.filter((r) => r.status === "golden").length;
  const pendingCount = records.filter((r) => r.status === "pending_review").length;
  const candidateCount = records.filter((r) => r.status === "candidate").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">
            Golden Records
          </h1>
          <p className="text-sm text-muted-foreground">
            Steward-approved authoritative master data records with field-level
            provenance
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#16A34A]/10">
              <Crown className="h-5 w-5 text-[#16A34A]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{goldenCount}</p>
              <p className="text-xs text-muted-foreground">Golden</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EA580C]/10">
              <AlertTriangle className="h-5 w-5 text-[#EA580C]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Pending Review</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{candidateCount}</p>
              <p className="text-xs text-muted-foreground">Candidates</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Domains</option>
          <option value="business_partner">Business Partner</option>
          <option value="material_master">Material Master</option>
          <option value="fi_gl">GL Accounts</option>
          <option value="employee_central">Employee Central</option>
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Statuses</option>
          <option value="candidate">Candidate</option>
          <option value="pending_review">Pending Review</option>
          <option value="golden">Golden</option>
          <option value="superseded">Superseded</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {total} record{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Records list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : records.length === 0 ? (
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Database className="h-12 w-12 text-white/[0.08]" />
            <h3 className="mt-4 font-semibold text-foreground">
              No golden records yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Golden records are created when sync batches are processed through
              the survivorship engine
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {records.map((record) => (
            <RecordRow key={record.id} record={record} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="border-black/[0.08] text-foreground"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="border-black/[0.08] text-foreground"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
