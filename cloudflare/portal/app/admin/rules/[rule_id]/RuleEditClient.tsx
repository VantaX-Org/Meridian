"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Rule, RuleCondition } from "@/lib/admin-api";

const OPERATORS = [
  { value: "is_null", label: "is null" },
  { value: "is_not_null", label: "is not null" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
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

const needsValue = (op: string) => !["is_null", "is_not_null"].includes(op);

const inputStyle = {
  background: "var(--background)",
  border: "1px solid var(--border)",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-5 space-y-4"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export default function RuleEditClient({ rule: initialRule }: { rule: Rule }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rule, setRule] = useState<Rule>(initialRule);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const showMsg = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(""), 4000);
  };

  const modules = MODULES_BY_CATEGORY[rule.category] || [];

  async function save() {
    setSaving(true);
    try {
      const resp = await fetch(`/api/admin/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rule.name,
          description: rule.description,
          module: rule.module,
          category: rule.category,
          severity: rule.severity,
          enabled: rule.enabled,
          conditions: rule.conditions,
          thresholds: rule.thresholds,
          tags: rule.tags,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const updated = await resp.json() as Rule;
      setRule(updated);
      showMsg("Saved");
    } catch (e) {
      showMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule() {
    setSaving(true);
    try {
      const resp = await fetch(`/api/admin/rules/${rule.id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await resp.text());
      startTransition(() => router.push("/admin/rules"));
    } catch (e) {
      showMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setSaving(false);
    }
  }

  function addCondition() {
    setRule({
      ...rule,
      conditions: [...rule.conditions, { field: "", operator: "is_not_null", value: "" }],
    });
  }

  function updateCondition(i: number, updates: Partial<RuleCondition>) {
    const next = rule.conditions.map((c, idx) => (idx === i ? { ...c, ...updates } : c));
    setRule({ ...rule, conditions: next });
  }

  function removeCondition(i: number) {
    setRule({ ...rule, conditions: rule.conditions.filter((_, idx) => idx !== i) });
  }

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = (e.target as HTMLInputElement).value.trim();
      if (val && !rule.tags.includes(val)) {
        setRule({ ...rule, tags: [...rule.tags, val] });
        (e.target as HTMLInputElement).value = "";
      }
    }
  }

  function removeTag(tag: string) {
    setRule({ ...rule, tags: rule.tags.filter((t) => t !== tag) });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <a href="/admin/rules" className="hover:text-white">Rules</a>
            <span>/</span>
            <span className="text-white">{rule.name}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">{rule.name}</h1>
          <p className="text-xs mt-1 font-mono" style={{ color: "var(--muted)" }}>
            {rule.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span
              className="text-sm"
              style={{ color: message.startsWith("Error") ? "#ef4444" : "#4ade80" }}
            >
              {message}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || isPending}
            className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Basic info */}
        <Section title="Rule Details">
          <Field label="Rule Name">
            <input
              type="text"
              required
              value={rule.name}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
              className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
              style={inputStyle}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={rule.description || ""}
              onChange={(e) => setRule({ ...rule, description: e.target.value })}
              rows={2}
              className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none resize-none"
              style={inputStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select
                value={rule.category}
                onChange={(e) =>
                  setRule({ ...rule, category: e.target.value, module: "" })
                }
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="ecc">ECC</option>
                <option value="successfactors">SuccessFactors</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </Field>
            <Field label="Module">
              <select
                value={rule.module}
                onChange={(e) => setRule({ ...rule, module: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="">Select module…</option>
                {modules.map((m) => (
                  <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Severity">
              <select
                value={rule.severity}
                onChange={(e) => setRule({ ...rule, severity: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                {["critical", "high", "medium", "low", "info"].map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <label className="flex h-[34px] cursor-pointer items-center gap-2">
                <span
                  className="relative inline-block h-5 w-9 rounded-full transition-colors"
                  style={{ background: rule.enabled ? "var(--primary)" : "var(--border)" }}
                  onClick={() => setRule({ ...rule, enabled: !rule.enabled })}
                >
                  <span
                    className="absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white transition-transform"
                    style={{ transform: rule.enabled ? "translateX(16px)" : "translateX(2px)" }}
                  />
                </span>
                <span className="text-sm text-white">{rule.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </Field>
          </div>
        </Section>

        {/* Tags */}
        <Section title="Tags">
          <div className="flex flex-wrap gap-2 min-h-[32px]">
            {rule.tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                style={{ background: "rgba(15,110,86,0.2)", color: "#4ade80" }}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            placeholder="Add tag, press Enter or comma…"
            onKeyDown={addTag}
            className="w-full rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none"
            style={inputStyle}
          />
        </Section>
      </div>

      {/* Conditions */}
      <Section title="Conditions">
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          All conditions must pass for this rule to be satisfied (AND logic).
        </p>
        <div className="space-y-3">
          {rule.conditions.map((cond, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-5 text-center text-xs" style={{ color: "var(--muted)" }}>
                {i + 1}
              </span>
              <input
                type="text"
                placeholder="Field name (e.g. BU_TYPE)"
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
              {needsValue(cond.operator) && (
                <input
                  type="text"
                  placeholder="Value"
                  value={cond.value}
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                  className="flex-1 rounded-md px-3 py-1.5 text-sm text-white outline-none"
                  style={inputStyle}
                />
              )}
              <button
                type="button"
                onClick={() => removeCondition(i)}
                className="text-sm transition-colors"
                style={{ color: "#ef4444" }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addCondition}
          className="text-sm transition-colors"
          style={{ color: "var(--primary)" }}
        >
          + Add Condition
        </button>
      </Section>

      {/* Danger zone */}
      <div className="flex items-center justify-end gap-3">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm transition-colors"
            style={{ color: "#ef4444" }}
          >
            Delete Rule
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "#f87171" }}>
              Delete &ldquo;{rule.name}&rdquo;?
            </span>
            <button
              onClick={deleteRule}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-xs text-white disabled:opacity-50"
              style={{ background: "#dc2626" }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs"
              style={{ color: "var(--muted)" }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
