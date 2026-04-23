"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RuleCondition } from "@/lib/admin-api";

const OPERATORS = [
  { value: "is_null", label: "is null" },
  { value: "is_not_null", label: "is not null" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "regex", label: "matches regex" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

const MODULES_BY_CATEGORY: Record<string, string[]> = {
  ecc: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing", "plant_maintenance",
    "production_planning", "sd_customer_master", "sd_sales_orders",
  ],
  successfactors: [
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
  ],
  warehouse: [
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management", "wm_interface",
    "cross_system_integration",
  ],
  // Cross-module rules span 2+ modules — the chosen "module" is the
  // owning pack name (e.g. "p2p", "otc"). The rule body carries
  // `sources` and `join_on` describing the actual modules involved.
  cross_module: ["p2p", "otc", "record_to_report"],
  // Customer-namespace rules target Y*/Z* extension tables. Module
  // here is the logical customer-pack name; rules set namespace="customer"
  // so findings surface distinctly.
  ztables: ["common", "tenant_specific"],
};

const CHECK_CLASS_OPTIONS = [
  { value: "", label: "— auto (legacy condition-based)" },
  { value: "null_check", label: "null_check — completeness" },
  { value: "regex_check", label: "regex_check — format" },
  { value: "domain_value_check", label: "domain_value_check — enum" },
  { value: "referential_check", label: "referential_check — FK" },
  { value: "cross_field_check", label: "cross_field_check — multi-field" },
  { value: "freshness_check", label: "freshness_check — timeliness" },
] as const;

const inputStyle = {
  background: "var(--background)",
  border: "1px solid var(--border)",
};

/**
 * Applies-when entry: a single {field: [values]} predicate. The rule
 * only runs against rows where every entry's field is in its allowed
 * list (AND-combined across entries). Empty fields / empty values are
 * skipped on submit so authors can iteratively build up without
 * breaking validation.
 */
interface AppliesWhenEntry {
  field: string;
  values: string; // comma-separated; split on submit
}

export default function NewRulePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "ecc",
    module: "",
    severity: "medium",
    enabled: true,
    tags: [] as string[],
    conditions: [] as RuleCondition[],
    check_class: "" as string,
    applies_when: [] as AppliesWhenEntry[],
    reference_values: "" as string, // comma-separated on submit
    namespace: "" as "" | "standard" | "customer",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const modules = MODULES_BY_CATEGORY[form.category] || [];

  function addCondition() {
    setForm({ ...form, conditions: [...form.conditions, { field: "", operator: "is_not_null", value: "" }] });
  }

  function updateCondition(i: number, updates: Partial<RuleCondition>) {
    setForm({
      ...form,
      conditions: form.conditions.map((c, idx) => (idx === i ? { ...c, ...updates } : c)),
    });
  }

  function removeCondition(i: number) {
    setForm({ ...form, conditions: form.conditions.filter((_, idx) => idx !== i) });
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = (e.target as HTMLInputElement).value.trim();
      if (val && !form.tags.includes(val)) {
        setForm({ ...form, tags: [...form.tags, val] });
        (e.target as HTMLInputElement).value = "";
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.module) { setError("Please select a module"); return; }
    setSaving(true);
    setError("");

    // Collapse applies_when entries to {field: [values]} and drop
    // entries with empty field or empty values.
    const appliesWhenBody: Record<string, string[]> = {};
    for (const entry of form.applies_when) {
      const field = entry.field.trim();
      const vals = entry.values
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== "");
      if (field !== "" && vals.length > 0) {
        appliesWhenBody[field] = vals;
      }
    }

    // Split comma-separated reference_values (for referential_check).
    const referenceValuesBody = form.reference_values
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");

    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description,
      category: form.category,
      module: form.module,
      severity: form.severity,
      enabled: form.enabled,
      tags: form.tags,
      conditions: form.conditions,
    };
    if (form.check_class) body.check_class = form.check_class;
    if (Object.keys(appliesWhenBody).length > 0) body.applies_when = appliesWhenBody;
    if (referenceValuesBody.length > 0) body.reference_values = referenceValuesBody;
    if (form.namespace) body.namespace = form.namespace;

    try {
      const resp = await fetch("/api/admin/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const data = await resp.json() as { message?: string };
        throw new Error(data.message || "Failed to create rule");
      }
      const data = await resp.json() as { id: string };
      router.push(`/admin/rules/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  function addAppliesWhen() {
    setForm({
      ...form,
      applies_when: [...form.applies_when, { field: "", values: "" }],
    });
  }

  function updateAppliesWhen(i: number, patch: Partial<AppliesWhenEntry>) {
    setForm({
      ...form,
      applies_when: form.applies_when.map((e, idx) =>
        idx === i ? { ...e, ...patch } : e,
      ),
    });
  }

  function removeAppliesWhen(i: number) {
    setForm({
      ...form,
      applies_when: form.applies_when.filter((_, idx) => idx !== i),
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
        <a href="/admin/rules" className="hover:text-white">Rules</a>
        <span>/</span>
        <span className="text-white">New Rule</span>
      </div>
      <h1 className="text-2xl font-bold text-white">Add Rule</h1>

      <form onSubmit={submit} className="space-y-5">
        <div
          className="rounded-lg p-5 space-y-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>Rule Name *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
              style={inputStyle}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none resize-none"
              style={inputStyle}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>Category *</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value, module: "" })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="ecc">ECC</option>
                <option value="successfactors">SuccessFactors</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>Module *</label>
              <select
                value={form.module}
                onChange={(e) => setForm({ ...form, module: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="">Select…</option>
                {modules.map((m) => (
                  <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                {["critical", "high", "medium", "low", "info"].map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>Tags</label>
              <input
                type="text"
                placeholder="Add tag, Enter to add…"
                onKeyDown={handleTagKeyDown}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none"
                style={inputStyle}
              />
            </div>
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                  style={{ background: "rgba(15,110,86,0.2)", color: "#4ade80" }}
                >
                  {tag}
                  <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((t) => t !== tag) })}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Conditions */}
        <div
          className="rounded-lg p-5 space-y-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-sm font-semibold text-white">Conditions</h2>
          {form.conditions.map((cond, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Field"
                value={cond.field}
                onChange={(e) => updateCondition(i, { field: e.target.value })}
                className="flex-1 rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              />
              <select
                value={cond.operator}
                onChange={(e) => updateCondition(i, { operator: e.target.value })}
                className="rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                {OPERATORS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              {!["is_null", "is_not_null"].includes(cond.operator) && (
                <input
                  type="text"
                  placeholder="Value"
                  value={cond.value}
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                  className="flex-1 rounded-md px-3 py-1.5 text-sm text-white outline-none"
                  style={inputStyle}
                />
              )}
              <button type="button" onClick={() => removeCondition(i)} style={{ color: "#ef4444" }}>×</button>
            </div>
          ))}
          <button type="button" onClick={addCondition} className="text-sm" style={{ color: "var(--primary)" }}>
            + Add Condition
          </button>
        </div>

        {/* Rule schema extensions — mirror the backend YAML shape (v0.0.20+). */}
        <div
          className="space-y-3 rounded-lg p-4"
          style={{ border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}
        >
          <h2 className="text-sm font-semibold text-white">
            Advanced — rule schema
          </h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Leave blank for legacy condition-based rules. Set these for
            the richer rule shapes introduced in v0.0.20+.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Check class
              </label>
              <select
                value={form.check_class}
                onChange={(e) => setForm({ ...form, check_class: e.target.value })}
                className="mt-1 w-full rounded-md px-3 py-2 text-sm text-white"
                style={inputStyle}
              >
                {CHECK_CLASS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Namespace
              </label>
              <select
                value={form.namespace}
                onChange={(e) =>
                  setForm({
                    ...form,
                    namespace: e.target.value as "" | "standard" | "customer",
                  })
                }
                className="mt-1 w-full rounded-md px-3 py-2 text-sm text-white"
                style={inputStyle}
              >
                <option value="">— standard (SAP-delivered)</option>
                <option value="customer">customer (Y*/Z*)</option>
              </select>
            </div>
          </div>

          {form.check_class === "referential_check" ? (
            <div>
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Reference values (comma-separated)
              </label>
              <input
                type="text"
                value={form.reference_values}
                onChange={(e) => setForm({ ...form, reference_values: e.target.value })}
                className="mt-1 w-full rounded-md px-3 py-2 text-sm text-white"
                style={inputStyle}
                placeholder="e.g. 0001, 0002, 0003, CPD, KRED"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                The allow-list this rule validates against (SAP baseline
                config values for KTOKK, ZTERM, MTART, etc.).
              </p>
            </div>
          ) : null}

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Applies when (context predicate)
              </label>
              <button
                type="button"
                onClick={addAppliesWhen}
                className="text-xs"
                style={{ color: "var(--primary)" }}
              >
                + Add field predicate
              </button>
            </div>
            {form.applies_when.length === 0 ? (
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                None — the rule applies to every row. Add a predicate to
                scope to rows where e.g. MARA.MTART is in FERT or HALB.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {form.applies_when.map((entry, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      type="text"
                      value={entry.field}
                      onChange={(e) => updateAppliesWhen(i, { field: e.target.value })}
                      placeholder="Field (e.g. MARA.MTART)"
                      className="rounded-md px-3 py-2 text-sm text-white"
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      value={entry.values}
                      onChange={(e) => updateAppliesWhen(i, { values: e.target.value })}
                      placeholder="Values (comma-separated): FERT, HALB"
                      className="rounded-md px-3 py-2 text-sm text-white"
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => removeAppliesWhen(i)}
                      className="rounded-md px-2 text-sm"
                      style={{ color: "#f87171", border: "1px solid var(--border)" }}
                      aria-label="Remove predicate"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-sm" style={{ color: "#f87171" }}>{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            {saving ? "Creating…" : "Create Rule"}
          </button>
          <a href="/admin/rules" className="rounded-md px-5 py-2 text-sm transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}>
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
