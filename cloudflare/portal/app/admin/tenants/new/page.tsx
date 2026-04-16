"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TIER_MODULES: Record<string, string[]> = {
  starter: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
  ],
  professional: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
  ],
  enterprise: [
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management", "wm_interface",
    "cross_system_integration",
  ],
};

const ONE_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  .toISOString()
  .split("T")[0];

export default function NewTenantPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    company_name: "",
    contact_email: "",
    tier: "professional",
    expiry_date: ONE_YEAR,
    status: "trial",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState<{ id: string; licence_key: string } | null>(null);

  const inputStyle = {
    background: "var(--background)",
    border: "1px solid var(--border)",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const resp = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          enabled_modules: TIER_MODULES[form.tier] || TIER_MODULES.starter,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json() as { message?: string };
        throw new Error(data.message || "Failed to create tenant");
      }
      const data = await resp.json() as { id: string; licence_key: string };
      setNewKey(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create tenant");
    } finally {
      setSaving(false);
    }
  }

  if (newKey) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <h1 className="text-2xl font-bold text-white">Tenant Created</h1>
        <div
          className="rounded-lg p-5 space-y-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#4ade80" }}>
            Licence key generated. Copy it now — it won&apos;t be shown again:
          </p>
          <div className="flex items-center gap-3">
            <code
              className="flex-1 rounded px-3 py-2 font-mono text-sm text-white"
              style={{ background: "var(--background)" }}
            >
              {newKey.licence_key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newKey.licence_key)}
              className="rounded px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              Copy
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Set this as <code className="font-mono">MERIDIAN_LICENCE_KEY</code> in the
            customer&apos;s deployment environment.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push(`/admin/tenants/${newKey.id}`)}
            className="rounded-md px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            View Tenant
          </button>
          <button
            onClick={() => router.push("/admin/tenants")}
            className="rounded-md px-5 py-2 text-sm transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Back to Tenants
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
        <a href="/admin/tenants" className="hover:text-white">Tenants</a>
        <span>/</span>
        <span className="text-white">New Tenant</span>
      </div>
      <h1 className="text-2xl font-bold text-white">Add Tenant</h1>

      <form onSubmit={submit} className="space-y-4">
        <div
          className="rounded-lg p-5 space-y-4"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          {[
            { key: "company_name", label: "Company Name", type: "text", required: true },
            { key: "contact_email", label: "Contact Email", type: "email", required: true },
          ].map(({ key, label, type, required }) => (
            <div key={key} className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                {label}
              </label>
              <input
                type={type}
                required={required}
                value={(form as Record<string, string>)[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Tier
              </label>
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
                style={inputStyle}
              >
                <option value="trial">Trial</option>
                <option value="active">Active</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
              Expiry Date
            </label>
            <input
              type="date"
              required
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              className="w-full rounded-md px-3 py-1.5 text-sm text-white outline-none"
              style={inputStyle}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "#f87171" }}>
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            {saving ? "Creating…" : "Create Tenant"}
          </button>
          <a
            href="/admin/tenants"
            className="rounded-md px-5 py-2 text-sm transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
