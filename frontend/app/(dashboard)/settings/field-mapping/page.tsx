"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Info,
  Check,
  AlertTriangle,
  RotateCcw,
  Save,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  getFieldMappings,
  updateFieldMapping,
  resetFieldMappings,
} from "@/lib/api/field-mappings";
import type { FieldMapping } from "@/lib/api/field-mappings";
import { PermissionDenied } from "@/components/role-gate";
import { useRole } from "@/hooks/use-role";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATA_TYPE_OPTIONS = ["string", "number", "date", "boolean"];

const MODULE_CATEGORY: Record<string, string> = {
  business_partner: "ECC",
  material_master: "ECC",
  fi_gl: "ECC",
  accounts_payable: "ECC",
  accounts_receivable: "ECC",
  asset_accounting: "ECC",
  mm_purchasing: "ECC",
  plant_maintenance: "ECC",
  production_planning: "ECC",
  sd_customer_master: "ECC",
  sd_sales_orders: "ECC",
  employee_central: "SuccessFactors",
  compensation: "SuccessFactors",
  benefits: "SuccessFactors",
  payroll_integration: "SuccessFactors",
  performance_goals: "SuccessFactors",
  succession_planning: "SuccessFactors",
  recruiting_onboarding: "SuccessFactors",
  learning_management: "SuccessFactors",
  time_attendance: "SuccessFactors",
  ewms_stock: "Warehouse",
  ewms_transfer_orders: "Warehouse",
  batch_management: "Warehouse",
  mdg_master_data: "Warehouse",
  fleet_management: "Warehouse",
  transport_management: "Warehouse",
};

function MappedBadge({ isMapped }: { isMapped: boolean }) {
  return isMapped ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#16A34A]/10 px-2 py-0.5 text-xs font-medium text-[#16A34A]">
      <Check className="h-3 w-3" />
      Confirmed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
      <AlertTriangle className="h-3 w-3" />
      Default
    </span>
  );
}

// ── Row editor ────────────────────────────────────────────────────────────────

interface RowEdits {
  customer_field: string;
  customer_label: string;
  data_type: string;
}

function MappingRow({
  mapping,
  editable,
  onChange,
  onConfirm,
  isSaving,
}: {
  mapping: FieldMapping;
  editable: boolean;
  onChange: (id: string, edits: Partial<RowEdits>) => void;
  onConfirm: (id: string) => void;
  isSaving: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_100px_auto] items-center gap-3 px-4 py-2.5 hover:bg-black/[0.02] transition-colors">
      {/* Standard field */}
      <div>
        <p className="text-xs font-mono text-foreground">{mapping.standard_field}</p>
        <p className="text-xs text-muted-foreground">{mapping.standard_label}</p>
      </div>

      {/* Customer field */}
      {editable ? (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={mapping.customer_field ?? mapping.standard_field}
            onChange={(e) =>
              onChange(mapping.id, { customer_field: e.target.value })
            }
            placeholder="SAP field name"
            className="rounded-lg border border-black/[0.10] bg-white/[0.60] px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30 transition-all"
          />
          <input
            type="text"
            value={mapping.customer_label ?? ""}
            onChange={(e) =>
              onChange(mapping.id, { customer_label: e.target.value })
            }
            placeholder="Label (optional)"
            className="rounded-lg border border-black/[0.10] bg-white/[0.60] px-2.5 py-1.5 text-xs text-muted-foreground outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30 transition-all"
          />
        </div>
      ) : (
        <div>
          <p className="text-xs font-mono text-foreground">
            {mapping.customer_field || mapping.standard_field}
          </p>
          <p className="text-xs text-muted-foreground">
            {mapping.customer_label || mapping.standard_label}
          </p>
        </div>
      )}

      {/* Data type */}
      {editable ? (
        <select
          value={mapping.data_type ?? "string"}
          onChange={(e) => onChange(mapping.id, { data_type: e.target.value })}
          className="rounded-lg border border-black/[0.10] bg-white/[0.60] px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
        >
          {DATA_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-muted-foreground">{mapping.data_type}</span>
      )}

      {/* Status + confirm */}
      <div className="flex items-center gap-2">
        <MappedBadge isMapped={mapping.is_mapped} />
        {editable && !mapping.is_mapped && (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onConfirm(mapping.id)}
            className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            Confirm
          </button>
        )}
      </div>
    </div>
  );
}

// ── Module group ──────────────────────────────────────────────────────────────

function ModuleMappingGroup({
  moduleName,
  mappings,
  editable,
  onChange,
  onConfirm,
  onReset,
  savingId,
}: {
  moduleName: string;
  mappings: FieldMapping[];
  editable: boolean;
  onChange: (id: string, edits: Partial<RowEdits>) => void;
  onConfirm: (id: string) => void;
  onReset: (module: string) => void;
  savingId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const unmapped = mappings.filter((m) => !m.is_mapped).length;
  const category = MODULE_CATEGORY[moduleName] ?? "Other";

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
          <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-xs text-muted-foreground">
            {category}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {unmapped > 0 && (
            <span className="text-xs text-yellow-600 font-medium">
              {unmapped} unconfirmed
            </span>
          )}
          <span className="text-xs text-muted-foreground">{mappings.length} fields</span>
        </div>
      </button>

      {expanded && (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_100px_auto] gap-3 border-t border-b border-black/[0.05] bg-black/[0.02] px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Standard Field
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Customer Field
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Type
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </span>
          </div>

          <div className="divide-y divide-black/[0.04]">
            {mappings.map((m) => (
              <MappingRow
                key={m.id}
                mapping={m}
                editable={editable}
                onChange={onChange}
                onConfirm={onConfirm}
                isSaving={savingId === m.id}
              />
            ))}
          </div>

          {editable && (
            <div className="flex justify-end gap-2 border-t border-black/[0.05] bg-black/[0.02] px-4 py-2">
              <button
                type="button"
                onClick={() => onReset(moduleName)}
                className="flex items-center gap-1.5 rounded-lg border border-black/[0.10] bg-white px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset module
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FieldMappingPage() {
  const { isAdmin } = useRole();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterModule, setFilterModule] = useState("");
  const [localEdits, setLocalEdits] = useState<
    Record<string, Partial<RowEdits>>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["field-mappings", filterModule, search],
    queryFn: () =>
      getFieldMappings({
        module: filterModule || undefined,
        search: search || undefined,
      }),
  });

  const selfServiceEnabled = data?.self_service_enabled ?? false;
  const editable = isAdmin && selfServiceEnabled;

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      updateFieldMapping(id, body as Parameters<typeof updateFieldMapping>[1]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field-mappings"] });
    },
    onError: () => toast.error("Failed to save mapping"),
  });

  const resetMutation = useMutation({
    mutationFn: (module?: string) => resetFieldMappings(module),
    onSuccess: (res) => {
      toast.success(`Reset ${res.reset_count} mappings`);
      qc.invalidateQueries({ queryKey: ["field-mappings"] });
    },
    onError: () => toast.error("Reset failed"),
  });

  const handleChange = useCallback(
    (id: string, edits: Partial<RowEdits>) => {
      setLocalEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...edits } }));
      // Optimistically update query cache
      qc.setQueryData(["field-mappings", filterModule, search], (old: typeof data) => {
        if (!old) return old;
        return {
          ...old,
          mappings: old.mappings.map((m) =>
            m.id === id ? { ...m, ...edits } : m
          ),
        };
      });
    },
    [qc, filterModule, search]
  );

  const handleConfirm = useCallback(
    async (id: string) => {
      const edits = localEdits[id] ?? {};
      setSavingId(id);
      try {
        await updateMutation.mutateAsync({
          id,
          body: { ...edits, is_mapped: true },
        });
        toast.success("Mapping confirmed");
        setLocalEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } finally {
        setSavingId(null);
      }
    },
    [localEdits, updateMutation]
  );

  const handleSaveAll = useCallback(async () => {
    const ids = Object.keys(localEdits);
    if (ids.length === 0) return;
    let saved = 0;
    for (const id of ids) {
      try {
        await updateMutation.mutateAsync({ id, body: localEdits[id] as object });
        saved++;
      } catch {
        // continue saving others
      }
    }
    toast.success(`Saved ${saved} of ${ids.length} mappings`);
    setLocalEdits({});
  }, [localEdits, updateMutation]);

  if (!isAdmin) {
    return (
      <PermissionDenied message="SAP Field Mapping is only accessible to administrators." />
    );
  }

  // Group by module
  const byModule: Record<string, FieldMapping[]> = {};
  for (const m of data?.mappings ?? []) {
    if (!byModule[m.module]) byModule[m.module] = [];
    byModule[m.module].push(m);
  }

  const modules = Object.keys(byModule).sort();
  const totalUnmapped =
    data?.mappings.filter((m) => !m.is_mapped).length ?? 0;
  const pendingEdits = Object.keys(localEdits).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            SAP Field Mapping
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Map Meridian standard field names to your custom SAP field names when you have
            custom Z-fields or name overrides.
          </p>
        </div>
        {editable && pendingEdits > 0 && (
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            Save {pendingEdits} change{pendingEdits !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Mode banner */}
      {!selfServiceEnabled ? (
        <div className="flex items-start gap-3 rounded-xl border border-black/[0.08] bg-black/[0.02] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Field mapping self-service is managed by your Meridian administrator.
            Contact Meridian HQ to enable customer-configurable field mappings or
            to request mapping changes.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-foreground/80">
            Self-service mode is enabled. You can customise field names below.
            Changes are synced to Meridian HQ on the next licence check-in.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Total Fields", value: data?.total ?? 0 },
          { label: "Modules", value: modules.length },
          {
            label: "Unconfirmed",
            value: totalUnmapped,
            color: totalUnmapped > 0 ? "text-yellow-600" : "text-[#16A34A]",
          },
        ].map(({ label, value, color }) => (
          <Card key={label} className="vx-card">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              {isLoading ? (
                <Skeleton className="mt-1 h-7 w-12" />
              ) : (
                <p className={`mt-1 text-2xl font-bold ${color ?? "text-foreground"}`}>
                  {value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="vx-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search fields..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
              />
            </div>
            <select
              value={filterModule}
              onChange={(e) => setFilterModule(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-white/[0.60] px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">All Modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {editable && (
              <button
                type="button"
                onClick={() => resetMutation.mutate(undefined)}
                disabled={resetMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl border border-black/[0.10] bg-white/[0.60] px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reset All
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Module groups */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : modules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/[0.10] py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No field mappings found. Run migrations to seed standard SAP fields.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {modules.map((mod) => (
            <ModuleMappingGroup
              key={mod}
              moduleName={mod}
              mappings={byModule[mod]}
              editable={editable}
              onChange={handleChange}
              onConfirm={handleConfirm}
              onReset={(m) => resetMutation.mutate(m)}
              savingId={savingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
