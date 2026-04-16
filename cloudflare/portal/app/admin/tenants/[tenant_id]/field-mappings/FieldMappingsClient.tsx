"use client";

import { useState } from "react";
import type { Tenant, FieldMapping } from "@/lib/admin-api";

const STANDARD_FIELDS: Record<string, Array<{ field: string; label: string; type: string }>> = {
  business_partner: [
    { field: "PARTNER", label: "Partner Number", type: "string" },
    { field: "BU_TYPE", label: "Business Partner Type", type: "string" },
    { field: "NAME_ORG1", label: "Organisation Name", type: "string" },
    { field: "NAME_LAST", label: "Last Name", type: "string" },
    { field: "NAME_FIRST", label: "First Name", type: "string" },
    { field: "COUNTRY", label: "Country", type: "string" },
    { field: "REGION", label: "Region", type: "string" },
    { field: "CITY1", label: "City", type: "string" },
    { field: "POST_CODE1", label: "Postal Code", type: "string" },
    { field: "TAXNUMTYPE", label: "Tax Number Type", type: "string" },
    { field: "STCD1", label: "Tax Number 1 (VAT)", type: "string" },
  ],
  material_master: [
    { field: "MATNR", label: "Material Number", type: "string" },
    { field: "MAKTX", label: "Material Description", type: "string" },
    { field: "MTART", label: "Material Type", type: "string" },
    { field: "MBRSH", label: "Industry Sector", type: "string" },
    { field: "MEINS", label: "Base Unit of Measure", type: "string" },
    { field: "MATKL", label: "Material Group", type: "string" },
    { field: "NTGEW", label: "Net Weight", type: "decimal" },
    { field: "GEWEI", label: "Weight Unit", type: "string" },
  ],
  employee_central: [
    { field: "PERNR", label: "Personnel Number", type: "string" },
    { field: "NACHN", label: "Last Name", type: "string" },
    { field: "VORNA", label: "First Name", type: "string" },
    { field: "LAND1", label: "Country", type: "string" },
    { field: "GBDAT", label: "Date of Birth", type: "date" },
    { field: "BEGDA", label: "Start Date", type: "date" },
    { field: "ENDDA", label: "End Date", type: "date" },
    { field: "PERSG", label: "Employee Group", type: "string" },
    { field: "PERSK", label: "Employee Subgroup", type: "string" },
  ],
};

const inputStyle = {
  background: "var(--background)",
  border: "1px solid var(--border)",
};

export default function FieldMappingsClient({
  tenant,
  initialMappings,
  currentModule,
}: {
  tenant: Tenant;
  initialMappings: FieldMapping[];
  currentModule: string;
}) {
  const [selectedModule, setSelectedModule] = useState(currentModule || "business_partner");
  const [mappings, setMappings] = useState<FieldMapping[]>(initialMappings);
  const [pendingEdits, setPendingEdits] = useState<
    Record<string, { customer_field: string; customer_label: string; is_mapped: boolean; notes: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const showMsg = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(""), 4000);
  };

  const standardFields = STANDARD_FIELDS[selectedModule] || [];

  // Build a map of existing mappings by field
  const mappingByField = Object.fromEntries(
    mappings
      .filter((m) => m.module === selectedModule)
      .map((m) => [m.standard_field, m])
  );

  function getEdit(field: string) {
    return (
      pendingEdits[field] || {
        customer_field: mappingByField[field]?.customer_field || "",
        customer_label: mappingByField[field]?.customer_label || "",
        is_mapped: mappingByField[field]?.is_mapped || false,
        notes: mappingByField[field]?.notes || "",
      }
    );
  }

  function updateEdit(
    field: string,
    key: "customer_field" | "customer_label" | "is_mapped" | "notes",
    value: string | boolean
  ) {
    setPendingEdits((prev) => ({
      ...prev,
      [field]: { ...getEdit(field), [key]: value },
    }));
  }

  async function saveAll() {
    setSaving(true);
    try {
      const mappingsToSave = standardFields.map(({ field, label, type }) => {
        const edit = getEdit(field);
        return {
          module: selectedModule,
          standard_field: field,
          standard_label: label,
          customer_field: edit.customer_field || null,
          customer_label: edit.customer_label || null,
          data_type: type,
          is_mapped: edit.is_mapped,
          notes: edit.notes || null,
        };
      });

      const resp = await fetch(
        `/api/admin/tenants/${tenant.id}/field-mappings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mappings: mappingsToSave }),
        }
      );
      if (!resp.ok) throw new Error(await resp.text());

      // Reload
      const listResp = await fetch(
        `/api/admin/tenants/${tenant.id}/field-mappings?module=${selectedModule}`,
        { cache: "no-store" }
      );
      if (listResp.ok) {
        const data = await listResp.json() as { field_mappings: FieldMapping[] };
        setMappings(data.field_mappings);
        setPendingEdits({});
      }
      showMsg("Saved successfully");
    } catch (e) {
      showMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setSaving(false);
    }
  }

  function applyDefaults() {
    const defaults: typeof pendingEdits = {};
    for (const { field, label } of standardFields) {
      defaults[field] = {
        customer_field: field,
        customer_label: label,
        is_mapped: true,
        notes: "",
      };
    }
    setPendingEdits(defaults);
  }

  const hasPendingEdits = Object.keys(pendingEdits).length > 0;
  const mappedCount = standardFields.filter(({ field }) => getEdit(field).is_mapped).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
          <a href="/admin/tenants" className="hover:text-white">Tenants</a>
          <span>/</span>
          <a href={`/admin/tenants/${tenant.id}`} className="hover:text-white">{tenant.company_name}</a>
          <span>/</span>
          <span className="text-white">Field Mappings</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">SAP Field Mappings</h1>
          <div className="flex items-center gap-3">
            {message && (
              <span
                className="text-sm"
                style={{ color: message.startsWith("Error") ? "#ef4444" : "#4ade80" }}
              >
                {message}
              </span>
            )}
            {hasPendingEdits && (
              <button
                onClick={saveAll}
                disabled={saving}
                className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ background: "var(--primary)" }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {tenant.company_name} — map standard SAP field names to customer-specific names
        </p>
        {!tenant.features.field_mapping_self_service && (
          <p
            className="mt-2 text-xs px-3 py-2 rounded-md"
            style={{ background: "rgba(15,110,86,0.1)", color: "#4ade80" }}
          >
            Self-service is disabled for this tenant — only HQ admins can edit mappings.
          </p>
        )}
      </div>

      {/* Module selector + actions */}
      <div className="flex items-center gap-3">
        <select
          value={selectedModule}
          onChange={(e) => {
            setSelectedModule(e.target.value);
            setPendingEdits({});
          }}
          className="rounded-md px-3 py-1.5 text-sm text-white outline-none"
          style={inputStyle}
        >
          {tenant.enabled_modules.map((m) => (
            <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {mappedCount} / {standardFields.length} mapped
        </span>
        <button
          onClick={applyDefaults}
          className="text-xs transition-colors"
          style={{ color: "var(--muted)" }}
        >
          Apply Standard Defaults
        </button>
      </div>

      {/* Mapping table */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.03)" }}>
              {["Standard Field", "Standard Label", "Customer Field", "Customer Label", "Mapped", "Notes"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {standardFields.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                  No standard fields defined for this module.
                </td>
              </tr>
            )}
            {standardFields.map(({ field, label }) => {
              const edit = getEdit(field);
              const isDirty = !!pendingEdits[field];
              return (
                <tr
                  key={field}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: isDirty ? "rgba(15,110,86,0.05)" : undefined,
                  }}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-white">{field}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>{label}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="text"
                      value={edit.customer_field}
                      onChange={(e) => updateEdit(field, "customer_field", e.target.value)}
                      placeholder={field}
                      className="w-full rounded px-2 py-1 text-xs text-white outline-none"
                      style={inputStyle}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="text"
                      value={edit.customer_label}
                      onChange={(e) => updateEdit(field, "customer_label", e.target.value)}
                      placeholder={label}
                      className="w-full rounded px-2 py-1 text-xs text-white outline-none"
                      style={inputStyle}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={edit.is_mapped}
                      onChange={(e) => updateEdit(field, "is_mapped", e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--primary)]"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="text"
                      value={edit.notes}
                      onChange={(e) => updateEdit(field, "notes", e.target.value)}
                      placeholder="Notes…"
                      className="w-full rounded px-2 py-1 text-xs text-white outline-none"
                      style={inputStyle}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasPendingEdits && (
        <div className="flex gap-3">
          <button
            onClick={saveAll}
            disabled={saving}
            className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            onClick={() => setPendingEdits({})}
            className="rounded-md px-5 py-2 text-sm transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
