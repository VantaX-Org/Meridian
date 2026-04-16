"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Tenant, TenantFeatures, LlmConfig } from "@/lib/admin-api";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_MODULES = {
  ECC: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
  ],
  SuccessFactors: [
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
  ],
  Warehouse: [
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management", "wm_interface",
    "cross_system_integration",
  ],
};

const TIER_MODULES: Record<string, string[]> = {
  starter: ALL_MODULES.ECC,
  professional: [...ALL_MODULES.ECC, ...ALL_MODULES.SuccessFactors],
  enterprise: [...ALL_MODULES.ECC, ...ALL_MODULES.SuccessFactors, ...ALL_MODULES.Warehouse],
};

const ALL_MENU_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "findings", label: "Findings" },
  { key: "versions", label: "Versions" },
  { key: "analytics", label: "Analytics" },
  { key: "import", label: "Import" },
  { key: "sync", label: "Run Sync" },
  { key: "reports", label: "Reports" },
  { key: "stewardship", label: "Stewardship" },
  { key: "contracts", label: "Contracts" },
  { key: "ask_meridian", label: "Ask Meridian" },
  { key: "export", label: "Export" },
  { key: "user_management", label: "User Management" },
  { key: "rules_engine", label: "Rules Engine" },
  { key: "settings", label: "Settings" },
  { key: "licence", label: "Licence Details" },
  { key: "field_mapping", label: "Field Mapping" },
];

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  readOnly,
  type = "text",
  className = "",
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      readOnly={readOnly}
      className={`w-full rounded-md px-3 py-1.5 text-sm text-white outline-none ${className}`}
      style={{
        background: readOnly ? "rgba(255,255,255,0.04)" : "var(--background)",
        border: "1px solid var(--border)",
        cursor: readOnly ? "default" : "text",
      }}
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <span
        className="relative inline-block h-5 w-9 rounded-full transition-colors"
        style={{ background: checked ? "var(--primary)" : "var(--border)" }}
        onClick={() => onChange(!checked)}
      >
        <span
          className="absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(2px)" }}
        />
      </span>
      <span className="text-sm text-white">{label}</span>
    </label>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function TenantDetailClient({ tenant: initialTenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [tenant, setTenant] = useState<Tenant>(initialTenant);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Offline token generation
  const [offlineTokenExpiry, setOfflineTokenExpiry] = useState("365");
  const [offlineToken, setOfflineToken] = useState<string | null>(null);
  const [offlineTokenExpires, setOfflineTokenExpires] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);

  const showMsg = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(""), 4000);
  };

  async function save() {
    setSaving(true);
    try {
      const resp = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: tenant.company_name,
          contact_email: tenant.contact_email,
          tier: tenant.tier,
          status: tenant.status,
          expiry_date: tenant.expiry_date,
          enabled_modules: tenant.enabled_modules,
          enabled_menu_items: tenant.enabled_menu_items,
          features: tenant.features,
          llm_config: tenant.llm_config,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const updated = await resp.json() as Tenant;
      setTenant(updated);
      showMsg("Saved successfully");
    } catch (e) {
      showMsg(`Error: ${e instanceof Error ? e.message : "Failed to save"}`);
    } finally {
      setSaving(false);
    }
  }

  async function regenerateKey() {
    setSaving(true);
    try {
      const resp = await fetch(`/api/admin/tenants/${tenant.id}/regenerate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json() as { licence_key: string };
      setNewKey(data.licence_key);
      setConfirmRegen(false);
    } catch (e) {
      showMsg(`Error: ${e instanceof Error ? e.message : "Failed to regenerate"}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTenant() {
    setSaving(true);
    try {
      const resp = await fetch(`/api/admin/tenants/${tenant.id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await resp.text());
      startTransition(() => router.push("/admin/tenants"));
    } catch (e) {
      showMsg(`Error: ${e instanceof Error ? e.message : "Failed to delete"}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleModule(mod: string) {
    const current = tenant.enabled_modules;
    const next = current.includes(mod)
      ? current.filter((m) => m !== mod)
      : [...current, mod];
    setTenant({ ...tenant, enabled_modules: next });
  }

  function toggleMenuItem(key: string) {
    const current = tenant.enabled_menu_items;
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    setTenant({ ...tenant, enabled_menu_items: next });
  }

  function applyTierPreset(tier: string) {
    setTenant({
      ...tenant,
      tier: tier as Tenant["tier"],
      enabled_modules: TIER_MODULES[tier] || TIER_MODULES.starter,
    });
  }

  function updateFeature<K extends keyof TenantFeatures>(k: K, v: TenantFeatures[K]) {
    setTenant({ ...tenant, features: { ...tenant.features, [k]: v } });
  }

  function updateLlm<K extends keyof LlmConfig>(k: K, v: LlmConfig[K]) {
    setTenant({ ...tenant, llm_config: { ...tenant.llm_config, [k]: v } });
  }

  const inputStyle = {
    background: "var(--background)",
    border: "1px solid var(--border)",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <a href="/admin/tenants" className="hover:text-white">Tenants</a>
            <span>/</span>
            <span className="text-white">{tenant.company_name}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">{tenant.company_name}</h1>
          <p className="text-xs mt-1 font-mono" style={{ color: "var(--muted)" }}>
            ID: {tenant.id}
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

      {/* New key alert */}
      {newKey && (
        <div
          className="rounded-md p-4 space-y-2"
          style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#4ade80" }}>
            New licence key generated — copy it now, it won&apos;t be shown again:
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 rounded px-3 py-2 font-mono text-sm text-white"
              style={{ background: "var(--card)" }}>
              {newKey}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newKey)}
              className="rounded px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Copy
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs" style={{ color: "var(--muted)" }}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Tenant info */}
        <Section title="Tenant Info">
          <Field label="Company Name">
            <Input
              value={tenant.company_name}
              onChange={(v) => setTenant({ ...tenant, company_name: v })}
            />
          </Field>
          <Field label="Contact Email">
            <Input
              value={tenant.contact_email}
              onChange={(v) => setTenant({ ...tenant, contact_email: v })}
            />
          </Field>
          <Field label="Tenant ID">
            <Input value={tenant.id} readOnly />
          </Field>
        </Section>

        {/* Licence */}
        <Section title="Licence">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tier">
              <select
                value={tenant.tier}
                onChange={(e) => applyTierPreset(e.target.value)}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                value={tenant.status}
                onChange={(e) => setTenant({ ...tenant, status: e.target.value as Tenant["status"] })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="suspended">Suspended</option>
                <option value="expired">Expired</option>
              </select>
            </Field>
          </div>
          <Field label="Expiry Date">
            <Input
              type="date"
              value={tenant.expiry_date}
              onChange={(v) => setTenant({ ...tenant, expiry_date: v })}
            />
          </Field>
          <Field label="Licence Key">
            <div className="flex items-center gap-3">
              <Input value={tenant.licence_key_masked || "(no key)"} readOnly className="flex-1" />
              {!confirmRegen ? (
                <button
                  onClick={() => setConfirmRegen(true)}
                  className="rounded-md px-3 py-1.5 text-xs whitespace-nowrap transition-colors"
                  style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
                >
                  Regenerate
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={regenerateKey}
                    disabled={saving}
                    className="rounded-md px-3 py-1.5 text-xs text-white"
                    style={{ background: "#dc2626" }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmRegen(false)}
                    className="rounded-md px-3 py-1.5 text-xs"
                    style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {confirmRegen && (
              <p className="text-xs mt-1" style={{ color: "#f87171" }}>
                This will invalidate the current key. The customer must update their deployment.
              </p>
            )}
          </Field>
          {tenant.last_ping && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Last validated:{" "}
              {new Date(tenant.last_ping).toLocaleString("en-ZA")}
            </p>
          )}
        </Section>

        {/* Features */}
        <Section title="Features">
          <Toggle
            checked={tenant.features.ask_meridian}
            onChange={(v) => updateFeature("ask_meridian", v)}
            label="Ask Meridian (AI chat)"
          />
          <Toggle
            checked={tenant.features.export_reports}
            onChange={(v) => updateFeature("export_reports", v)}
            label="Export Reports"
          />
          <Toggle
            checked={tenant.features.run_sync}
            onChange={(v) => updateFeature("run_sync", v)}
            label="Run Sync"
          />
          <Toggle
            checked={tenant.features.field_mapping_self_service}
            onChange={(v) => updateFeature("field_mapping_self_service", v)}
            label="Field Mapping Self-Service"
          />
          <Field label="Max Users">
            <Input
              type="number"
              value={String(tenant.features.max_users)}
              onChange={(v) => updateFeature("max_users", parseInt(v, 10) || 20)}
            />
          </Field>
        </Section>

        {/* LLM Config */}
        <Section title="LLM Configuration">
          <Field label="Tier">
            <select
              value={tenant.llm_config.tier}
              onChange={(e) => updateLlm("tier", parseInt(e.target.value, 10) as 1 | 2 | 3)}
              className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
              style={inputStyle}
            >
              <option value={1}>Tier 1 — Cloud API</option>
              <option value={2}>Tier 2 — Bundled Ollama</option>
              <option value={3}>Tier 3 — BYOLLM</option>
            </select>
          </Field>
          {tenant.llm_config.tier === 2 && (
            <Field label="Model Name">
              <Input
                value={tenant.llm_config.model || ""}
                onChange={(v) => updateLlm("model", v)}
              />
            </Field>
          )}
          <Field label="Notes">
            <Input
              value={tenant.llm_config.notes || ""}
              onChange={(v) => updateLlm("notes", v)}
            />
          </Field>
        </Section>
      </div>

      {/* SAP Module Toggles */}
      <div
        className="rounded-lg p-5 space-y-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">SAP Modules</h2>
          <div className="flex gap-2">
            {(["starter", "professional", "enterprise"] as const).map((t) => (
              <button
                key={t}
                onClick={() => applyTierPreset(t)}
                className="rounded px-2.5 py-1 text-xs capitalize transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                {t} preset
              </button>
            ))}
          </div>
        </div>

        {Object.entries(ALL_MODULES).map(([category, modules]) => (
          <div key={category}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {category}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setTenant({
                      ...tenant,
                      enabled_modules: [
                        ...new Set([...tenant.enabled_modules, ...modules]),
                      ],
                    })
                  }
                  className="text-xs"
                  style={{ color: "var(--primary)" }}
                >
                  Enable all
                </button>
                <button
                  onClick={() =>
                    setTenant({
                      ...tenant,
                      enabled_modules: tenant.enabled_modules.filter(
                        (m) => !modules.includes(m)
                      ),
                    })
                  }
                  className="text-xs"
                  style={{ color: "var(--muted)" }}
                >
                  Disable all
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {modules.map((mod) => {
                const on = tenant.enabled_modules.includes(mod);
                return (
                  <label
                    key={mod}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleModule(mod)}
                      className="h-3.5 w-3.5 accent-[var(--primary)]"
                    />
                    <span className="text-xs text-white">
                      {mod.replace(/_/g, " ")}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Menu Item Toggles */}
      <div
        className="rounded-lg p-5 space-y-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-sm font-semibold text-white">Menu Items</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ALL_MENU_ITEMS.map(({ key, label }) => {
            const on = tenant.enabled_menu_items.includes(key);
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleMenuItem(key)}
                  className="h-3.5 w-3.5 accent-[var(--primary)]"
                />
                <span className="text-xs text-white">{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Offline Licence Token */}
      <div
        className="rounded-lg p-5 space-y-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold text-white">Offline Licence Token</h2>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            For air-gapped deployments that cannot reach the licence server.
            The customer sets <code className="font-mono">MERIDIAN_LICENCE_MODE=offline</code> and{" "}
            <code className="font-mono">MERIDIAN_LICENCE_TOKEN=&lt;token&gt;</code> in their .env.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
              Token validity (days)
            </label>
            <input
              type="number"
              min={30}
              max={1095}
              value={offlineTokenExpiry}
              onChange={(e) => setOfflineTokenExpiry(e.target.value)}
              className="w-24 rounded-md px-3 py-1.5 text-sm text-white outline-none"
              style={{ background: "var(--background)", border: "1px solid var(--border)" }}
            />
          </div>
          <button
            onClick={async () => {
              setGeneratingToken(true);
              setOfflineToken(null);
              try {
                const r = await fetch(`/api/admin/tenants/${tenant.id}/offline-token`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ expiryDays: parseInt(offlineTokenExpiry, 10) || 365 }),
                });
                if (r.ok) {
                  const d = await r.json();
                  setOfflineToken(d.token);
                  setOfflineTokenExpires(d.expiresAt);
                } else {
                  showMsg("Failed to generate offline token");
                }
              } finally {
                setGeneratingToken(false);
              }
            }}
            disabled={generatingToken}
            className="rounded-md px-4 py-1.5 text-sm text-white disabled:opacity-50 transition-colors"
            style={{ background: "var(--primary)" }}
          >
            {generatingToken ? "Generating…" : "Generate Token"}
          </button>
        </div>
        {offlineToken && (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Expires: {offlineTokenExpires ? new Date(offlineTokenExpires).toLocaleString("en-ZA") : "—"}
            </p>
            <textarea
              readOnly
              rows={4}
              value={offlineToken}
              className="w-full rounded-md px-3 py-2 text-xs font-mono text-white outline-none resize-none"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)" }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(offlineToken)}
                className="rounded px-3 py-1 text-xs transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                Copy Token
              </button>
              <button
                onClick={() => {
                  const snippet =
                    `MERIDIAN_LICENCE_MODE=offline\nMERIDIAN_LICENCE_TOKEN=${offlineToken}\n`;
                  const blob = new Blob([snippet], { type: "text/plain" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `meridian-offline-licence-${tenant.id.slice(0, 8)}.env`;
                  a.click();
                }}
                className="rounded px-3 py-1 text-xs transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                Download .env snippet
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <a
          href={`/admin/tenants/${tenant.id}/field-mappings`}
          className="text-sm transition-colors"
          style={{ color: "var(--primary)" }}
        >
          Manage Field Mappings →
        </a>

        {/* Danger zone */}
        <div className="flex items-center gap-3">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm transition-colors"
              style={{ color: "#ef4444" }}
            >
              Delete Tenant
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: "#f87171" }}>
                This is irreversible. Delete &ldquo;{tenant.company_name}&rdquo;?
              </span>
              <button
                onClick={deleteTenant}
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
    </div>
  );
}
