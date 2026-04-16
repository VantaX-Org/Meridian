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
};

const inputStyle = {
  background: "var(--background)",
  border: "1px solid var(--border)",
};

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
    try {
      const resp = await fetch("/api/admin/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
