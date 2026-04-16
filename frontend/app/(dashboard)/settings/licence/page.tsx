"use client";

import { useLicence } from "@/hooks/use-licence";
import { CheckCircle, Lock, AlertTriangle, Clock, RefreshCw } from "lucide-react";

const ALL_MODULES: Record<string, { label: string; category: string }> = {
  // ECC
  business_partner:   { label: "Business Partner",      category: "ECC" },
  material_master:    { label: "Material Master",        category: "ECC" },
  fi_gl:              { label: "FI/GL",                  category: "ECC" },
  accounts_payable:   { label: "Accounts Payable",       category: "ECC" },
  accounts_receivable:{ label: "Accounts Receivable",    category: "ECC" },
  asset_accounting:   { label: "Asset Accounting",       category: "ECC" },
  mm_purchasing:      { label: "MM Purchasing",          category: "ECC" },
  plant_maintenance:  { label: "Plant Maintenance",      category: "ECC" },
  production_planning:{ label: "Production Planning",    category: "ECC" },
  sd_customer_master: { label: "SD Customer Master",     category: "ECC" },
  sd_sales_orders:    { label: "SD Sales Orders",        category: "ECC" },
  // SuccessFactors
  employee_central:       { label: "Employee Central",       category: "SuccessFactors" },
  compensation:           { label: "Compensation",           category: "SuccessFactors" },
  benefits:               { label: "Benefits",               category: "SuccessFactors" },
  payroll_integration:    { label: "Payroll Integration",    category: "SuccessFactors" },
  performance_goals:      { label: "Performance & Goals",    category: "SuccessFactors" },
  succession_planning:    { label: "Succession Planning",    category: "SuccessFactors" },
  recruiting_onboarding:  { label: "Recruiting & Onboarding",category: "SuccessFactors" },
  learning_management:    { label: "Learning Management",    category: "SuccessFactors" },
  time_attendance:        { label: "Time & Attendance",      category: "SuccessFactors" },
  // Warehouse
  ewms_stock:             { label: "EWM Stock",              category: "Warehouse" },
  ewms_transfer_orders:   { label: "EWM Transfer Orders",    category: "Warehouse" },
  batch_management:       { label: "Batch Management",       category: "Warehouse" },
  mdg_master_data:        { label: "MDG Master Data",        category: "Warehouse" },
  grc_compliance:         { label: "GRC Compliance",         category: "Warehouse" },
  fleet_management:       { label: "Fleet Management",       category: "Warehouse" },
  transport_management:   { label: "Transport Management",   category: "Warehouse" },
  wm_interface:           { label: "WM Interface",           category: "Warehouse" },
  cross_system_integration:{ label: "Cross-System Integration",category: "Warehouse"},
};

const FEATURE_LABELS: Record<string, string> = {
  ask_meridian:              "Ask Meridian (AI chat)",
  export_reports:            "Export Reports",
  run_sync:                  "Run Sync",
  field_mapping_self_service:"SAP Field Mapping (self-service)",
};

const TIER_LABEL: Record<string, string> = {
  starter:      "Starter",
  professional: "Professional",
  enterprise:   "Enterprise",
};

function relTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({ status, daysRemaining }: { status: string; daysRemaining?: number }) {
  let bg = "bg-[#16A34A]/15";
  let text = "text-[#16A34A]";
  let label = "Active";

  if (status === "trial") {
    bg = "bg-[#0891B2]/15"; text = "text-[#0891B2]"; label = "Trial";
  } else if (status === "suspended" || status === "invalid") {
    bg = "bg-[#DC2626]/15"; text = "text-[#DC2626]"; label = "Suspended";
  } else if (status === "expired") {
    bg = "bg-[#6B7280]/15"; text = "text-[#6B7280]"; label = "Expired";
  } else if (daysRemaining !== undefined && daysRemaining <= 30 && daysRemaining > 0) {
    bg = "bg-[#D97706]/15"; text = "text-[#D97706]"; label = "Expiring Soon";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${bg} ${text}`}>
      <span className="h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
      {label}
    </span>
  );
}

const CATEGORIES = ["ECC", "SuccessFactors", "Warehouse"];

export default function LicencePage() {
  const { manifest, isLoading } = useLicence();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Licence Details</h1>
        <div className="vx-card rounded-2xl p-6 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Checking licence…</span>
        </div>
      </div>
    );
  }

  const { valid, status, company_name, tier, expiry_date, days_remaining,
          enabled_modules, enabled_menu_items, features, last_validated } = manifest;

  const licenceKeyMasked = "MRDX-****-****-????";
  const allModulesEnabled = enabled_modules.includes("*");
  const allMenuEnabled = enabled_menu_items.includes("*");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Licence Details</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Meridian licence status, modules, and feature entitlements.
        </p>
      </div>

      {/* Status card */}
      <div className="vx-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Licence Status
            </p>
            <div className="flex items-center gap-3">
              <StatusBadge status={status} daysRemaining={days_remaining} />
              {tier && (
                <span className="rounded-full bg-primary/[0.12] px-3 py-1 text-sm font-medium text-primary">
                  {TIER_LABEL[tier] || tier}
                </span>
              )}
            </div>
          </div>
          {valid === false && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive font-medium">
                Contact your Meridian administrator to renew
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
          {company_name && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Organisation</p>
              <p className="font-medium text-foreground">{company_name}</p>
            </div>
          )}
          {expiry_date && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Expiry</p>
              <p className="font-medium text-foreground">{formatDate(expiry_date)}</p>
            </div>
          )}
          {days_remaining !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Days Remaining</p>
              <p
                className="font-medium"
                style={{
                  color:
                    days_remaining <= 7 ? "#DC2626"
                    : days_remaining <= 30 ? "#D97706"
                    : "#16A34A",
                }}
              >
                {days_remaining > 0 ? `${days_remaining} days` : "Expired"}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Licence Key</p>
            <p className="font-mono text-sm text-foreground">{licenceKeyMasked}</p>
          </div>
        </div>

        {last_validated && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Last validated {relTime(last_validated)}
          </div>
        )}
      </div>

      {/* SAP Modules */}
      <div className="vx-card rounded-2xl p-6 space-y-5">
        <h2 className="font-semibold text-foreground">Licensed SAP Modules</h2>
        {CATEGORIES.map((cat) => {
          const catModules = Object.entries(ALL_MODULES).filter(
            ([, meta]) => meta.category === cat
          );
          return (
            <div key={cat}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {cat}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {catModules.map(([id, meta]) => {
                  const licensed = allModulesEnabled || enabled_modules.includes(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                        licensed
                          ? "bg-primary/[0.06] text-foreground"
                          : "bg-black/[0.02] text-muted-foreground"
                      }`}
                    >
                      {licensed ? (
                        <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Lock className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                      <span className="truncate">{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Features */}
      <div className="vx-card rounded-2xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">Feature Entitlements</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(FEATURE_LABELS).map(([key, label]) => {
            const enabled =
              allMenuEnabled ||
              features[key as keyof typeof features] === true;
            return (
              <div
                key={key}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  enabled ? "bg-primary/[0.06] text-foreground" : "bg-black/[0.02] text-muted-foreground"
                }`}
              >
                {enabled ? (
                  <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
                <span>{label}</span>
              </div>
            );
          })}
          {features.max_users !== undefined && (
            <div className="flex items-center gap-2 rounded-xl bg-primary/[0.06] px-3 py-2 text-sm text-foreground">
              <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
              <span>Up to {features.max_users} users</span>
            </div>
          )}
        </div>
      </div>

      {/* Contact / upgrade */}
      <div className="vx-card rounded-2xl p-5 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Need to upgrade your licence or add more modules?
        </p>
        <a
          href="mailto:support@meridian.vantax.co.za"
          className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Contact Meridian
        </a>
      </div>
    </div>
  );
}
