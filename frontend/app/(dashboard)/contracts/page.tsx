"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI } from "@/components/meridian/atoms";
import { MoreH, SparklesIcon, ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createContract, getContracts } from "@/lib/api/contracts";
import { copyToClipboard } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import { relativeTime } from "@/lib/format";
import type { Contract, ContractStatus } from "@/types/api";

function statusBadgeStyle(s: ContractStatus): { bg: string; fg: string; l: string } {
  switch (s) {
    case "active":
      return { bg: "var(--mn-pos-bg)", fg: "var(--mn-pos)", l: "ACTIVE" };
    case "draft":
      return { bg: "var(--mn-warn-bg)", fg: "var(--mn-warn)", l: "DRAFT" };
    case "pending_approval":
      return { bg: "var(--mn-primary-50)", fg: "var(--mn-primary-700)", l: "PENDING" };
    case "expired":
      return { bg: "var(--mn-neg-bg)", fg: "var(--mn-neg)", l: "EXPIRED" };
  }
}

function freshnessLabel(c: Contract): string {
  const f = c.freshness_contract;
  if (f && typeof f === "object") {
    const v = (f as Record<string, unknown>)["max_age"] ?? (f as Record<string, unknown>)["window"];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return "—";
}

function schemaLabel(c: Contract): string {
  const s = c.schema_contract;
  if (s && typeof s === "object") {
    const v = (s as Record<string, unknown>)["version"];
    if (typeof v === "string" || typeof v === "number") return `v${v}`;
  }
  return "—";
}

function complianceLabel(c: Contract): number | null {
  if (typeof c.latest_compliant === "boolean") return c.latest_compliant ? 100 : 0;
  return null;
}

export default function ContractsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | ContractStatus>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["contracts.list", { status: statusFilter }],
    queryFn: () => getContracts(statusFilter === "all" ? undefined : statusFilter),
  });

  const create = useMutation({
    mutationFn: createContract,
    onSuccess: () => {
      toast.success("Contract created");
      setNewOpen(false);
      qc.invalidateQueries({ queryKey: ["contracts.list"] });
    },
    onError: () => toast.error("Could not create contract"),
  });

  const allContracts: Contract[] = data?.contracts ?? [];
  const contracts = allContracts.filter((c) => matchesSearch(c, search));
  const total = data?.total ?? allContracts.length;

  const counts = {
    active: allContracts.filter((c) => c.status === "active").length,
    draft: allContracts.filter((c) => c.status === "draft").length,
    pending: allContracts.filter((c) => c.status === "pending_approval").length,
    expired: allContracts.filter((c) => c.status === "expired").length,
    breached: allContracts.filter((c) => c.status === "active" && c.latest_compliant === false).length,
  };

  if (isLoading) {
    return (
      <>
        <PageHead title="Contracts" route="Govern · /contracts" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Contracts" route="Govern · /contracts" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/contracts</code>.
        </div>
      </>
    );
  }

  const breachedHero = allContracts.find((c) => c.status === "active" && c.latest_compliant === false);

  return (
    <>
      <PageHead
        title="Contracts"
        route="Govern · /contracts"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} data contracts</strong> defined between systems.{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{counts.active} active</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{counts.draft} draft</strong>,{" "}
            <strong style={{ color: "var(--mn-neg)" }}>{counts.breached} breached</strong>.
          </>
        }
        actions={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Filter contracts…" />
            <Dialog open={newOpen} onOpenChange={setNewOpen}>
              <DialogTrigger type="button" className="mn-btn mn-btn-primary">
                New contract
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New data contract</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    create.mutate({
                      name: String(fd.get("name") ?? ""),
                      producer: String(fd.get("producer") ?? ""),
                      consumer: String(fd.get("consumer") ?? ""),
                      description: String(fd.get("description") ?? "") || undefined,
                    });
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Contract name</span>
                      <input name="name" required className="mn-input" placeholder="e.g. Vendor master sync" />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Producer system</span>
                        <input name="producer" required className="mn-input" placeholder="e.g. ECC PRD" />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Consumer system</span>
                        <input name="consumer" required className="mn-input" placeholder="e.g. S/4HANA Cloud" />
                      </label>
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Description (optional)</span>
                      <textarea name="description" rows={3} className="mn-input" placeholder="What does this contract govern?" />
                    </label>
                  </div>
                  <DialogFooter>
                    <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setNewOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="mn-btn mn-btn-primary" disabled={create.isPending}>
                      {create.isPending ? "Creating…" : "Create contract"}
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Active" value={counts.active} tone="pos" />
        <KPI label="Breached" value={counts.breached} tone={counts.breached > 0 ? "neg" : "pos"} />
        <KPI label="Pending approval" value={counts.pending} tone="warn" />
        <KPI label="Draft" value={counts.draft} />
      </div>

      {breachedHero && (
        <div className="mn-narrative" style={{ marginBottom: 18 }}>
          <div className="ico"><SparklesIcon size={15} /></div>
          <div style={{ flex: 1 }}>
            <div className="mn-narrative-headline">
              {counts.breached} active contract{counts.breached === 1 ? "" : "s"} breaching compliance.
            </div>
            <div className="mn-narrative-detail">
              {breachedHero.name} ({breachedHero.producer} → {breachedHero.consumer}) — last checked{" "}
              {breachedHero.last_checked ? relativeTime(breachedHero.last_checked) : "—"}.
            </div>
          </div>
          <button
            type="button"
            className="mn-btn mn-btn-ghost"
            style={{ background: "white" }}
            onClick={() => setStatusFilter("active")}
          >
            Review breaches <ArrowRight size={13} />
          </button>
        </div>
      )}

      <div className="mn-segment" style={{ marginBottom: 12 }}>
        {(["all", "active", "pending_approval", "draft", "expired"] as const).map((k) => (
          <button key={k} type="button" className={statusFilter === k ? "on" : ""} onClick={() => setStatusFilter(k)}>
            {k === "all" ? "All" : k === "pending_approval" ? "Pending" : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      <div className="mn-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
        {contracts.map((c) => {
          const sc = statusBadgeStyle(c.status);
          const breached = c.status === "active" && c.latest_compliant === false;
          return (
            <div key={c.id} className={`mn-contract ${breached ? "breached" : ""}`}>
              <div className="mn-contract-head">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      className="mn-tabular"
                      style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                    >
                      {c.id.slice(0, 8)}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        padding: "2px 6px",
                        borderRadius: 3,
                        background: sc.bg,
                        color: sc.fg,
                        font: "700 9.5px/1 'JetBrains Mono', monospace",
                        letterSpacing: "0.1em",
                      }}
                    >
                      {sc.l}
                    </span>
                  </div>
                  <h3 className="mn-contract-title">{c.name}</h3>
                </div>
                <button
                  type="button"
                  className="mn-icon-btn"
                  aria-label="Copy contract ID"
                  onClick={() => copyToClipboard(c.id, "Contract ID copied")}
                >
                  <MoreH size={14} />
                </button>
              </div>

              <div className="mn-contract-flow">
                <div className="node producer">
                  <div className="lbl">Producer</div>
                  <div className="name">{c.producer}</div>
                </div>
                <div className="arrow">
                  <svg viewBox="0 0 60 24" width="60" height="24" aria-hidden="true">
                    <path d="M 4 12 L 52 12" stroke="var(--mn-line-3)" strokeWidth="1.5" strokeDasharray="3 3" />
                    <path
                      d="m 48 6 8 6 -8 6"
                      stroke="var(--mn-line-3)"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="node consumer">
                  <div className="lbl">Consumer</div>
                  <div className="name">{c.consumer}</div>
                </div>
              </div>

              <div className="mn-contract-stats">
                <div><span className="mn-eyebrow">Freshness</span><span className="v mn-tabular">{freshnessLabel(c)}</span></div>
                <div><span className="mn-eyebrow">Schema</span><span className="v mn-tabular">{schemaLabel(c)}</span></div>
                <div>
                  <span className="mn-eyebrow">Compliance</span>
                  {complianceLabel(c) !== null ? (
                    <span className="v mn-tabular" style={{ color: breached ? "var(--mn-neg)" : "var(--mn-pos)" }}>
                      {complianceLabel(c)}%
                    </span>
                  ) : (
                    <span className="v" style={{ color: "var(--mn-ink-300)" }}>—</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {contracts.length === 0 && (
          <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
            No contracts match this filter.
          </div>
        )}
      </div>
    </>
  );
}
