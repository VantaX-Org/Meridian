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
  cross_module: ["p2p", "otc", "record_to_report"],
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

function AppliesWhenRow({
  field,
  values,
  onFieldChange,
  onValuesChange,
  onRemove,
}: {
  field: string;
  values: string[];
  onFieldChange: (field: string) => void;
  onValuesChange: (values: string[]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
      <input
        type="text"
        value={field}
        onChange={(e) => onFieldChange(e.target.value)}
        placeholder="Field (e.g. MARA.MTART)"
        className="rounded-md px-3 py-2 text-sm text-white"
        style={inputStyle}
      />
      <input
        type="text"
        value={values.join(", ")}
        onChange={(e) =>
          onValuesChange(
            e.target.value
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v !== ""),
          )
        }
        placeholder="Values (comma-separated): FERT, HALB"
        className="rounded-md px-3 py-2 text-sm text-white"
        style={inputStyle}
      />
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md px-2 text-sm"
        style={{ color: "#f87171", border: "1px solid var(--border)" }}
        aria-label="Remove predicate"
      >
        ×
      </button>
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
      // Include the v0.0.20+ rule-schema extensions so editing a rule
      // doesn't silently drop check_class, applies_when, reference_values,
      // namespace, sources, or join_on. Only include a field when it
      // has a meaningful value so legacy rules keep their lean shape.
      const body: Record<string, unknown> = {
        name: rule.name,
        description: rule.description,
        module: rule.module,
        category: rule.category,
        severity: rule.severity,
        enabled: rule.enabled,
        conditions: rule.conditions,
        thresholds: rule.thresholds,
        tags: rule.tags,
      };
      if (rule.check_class) body.check_class = rule.check_class;
      if (rule.applies_when && Object.keys(rule.applies_when).length > 0) {
        body.applies_when = rule.applies_when;
      }
      if (rule.reference_values && rule.reference_values.length > 0) {
        body.reference_values = rule.reference_values;
      }
      if (rule.namespace) body.namespace = rule.namespace;
      if (rule.sources && rule.sources.length > 0) body.sources = rule.sources;
      if (rule.join_on && rule.join_on.length > 0) body.join_on = rule.join_on;

      const resp = await fetch(`/api/admin/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

      <Section title="Advanced — rule schema (v0.0.20+)">
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          These fields mirror the backend YAML shape. Leave blank for
          legacy condition-based rules.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Check class">
            <select
              value={rule.check_class ?? ""}
              onChange={(e) =>
                setRule({
                  ...rule,
                  check_class:
                    (e.target.value || undefined) as Rule["check_class"],
                })
              }
              className="w-full rounded-md px-3 py-2 text-sm text-white"
              style={inputStyle}
            >
              {CHECK_CLASS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Namespace">
            <select
              value={rule.namespace ?? ""}
              onChange={(e) =>
                setRule({
                  ...rule,
                  namespace:
                    (e.target.value || undefined) as Rule["namespace"],
                })
              }
              className="w-full rounded-md px-3 py-2 text-sm text-white"
              style={inputStyle}
            >
              <option value="">— standard (SAP-delivered)</option>
              <option value="customer">customer (Y-star / Z-star)</option>
            </select>
          </Field>
        </div>

        {rule.check_class === "referential_check" ? (
          <Field label="Reference values (comma-separated)">
            <input
              type="text"
              value={(rule.reference_values ?? []).join(", ")}
              onChange={(e) => {
                const next = e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter((v) => v !== "");
                setRule({
                  ...rule,
                  reference_values: next.length > 0 ? next : undefined,
                });
              }}
              className="w-full rounded-md px-3 py-2 text-sm text-white"
              style={inputStyle}
              placeholder="e.g. 0001, 0002, 0003, CPD, KRED"
            />
          </Field>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label
              className="block text-xs font-medium"
              style={{ color: "var(--muted)" }}
            >
              Applies when (context predicate)
            </label>
            <button
              type="button"
              className="text-xs"
              style={{ color: "var(--primary)" }}
              onClick={() => {
                const next = { ...(rule.applies_when ?? {}) };
                // Use a placeholder key the author replaces; if "" already
                // exists, numbers 1, 2, ... keep it unique.
                let key = "";
                let i = 1;
                while (key in next) {
                  key = `field_${i++}`;
                }
                next[key] = [];
                setRule({ ...rule, applies_when: next });
              }}
            >
              + Add field predicate
            </button>
          </div>
          {Object.keys(rule.applies_when ?? {}).length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              None — the rule applies to every row. Add a predicate to
              scope (e.g. MARA.MTART in FERT, HALB).
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(rule.applies_when ?? {}).map(
                ([field, values]) => (
                  <AppliesWhenRow
                    key={field}
                    field={field}
                    values={values}
                    onFieldChange={(nextField) => {
                      // Rename the key while preserving its values.
                      const entries = Object.entries(rule.applies_when ?? {});
                      const nextMap: Record<string, string[]> = {};
                      for (const [k, v] of entries) {
                        nextMap[k === field ? nextField : k] = v;
                      }
                      setRule({ ...rule, applies_when: nextMap });
                    }}
                    onValuesChange={(nextValues) => {
                      const next = { ...(rule.applies_when ?? {}) };
                      next[field] = nextValues;
                      setRule({ ...rule, applies_when: next });
                    }}
                    onRemove={() => {
                      const next = { ...(rule.applies_when ?? {}) };
                      delete next[field];
                      setRule({
                        ...rule,
                        applies_when:
                          Object.keys(next).length > 0 ? next : undefined,
                      });
                    }}
                  />
                ),
              )}
            </div>
          )}
        </div>
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
