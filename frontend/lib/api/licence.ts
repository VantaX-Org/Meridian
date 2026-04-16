import apiClient from "./client";

export interface LicenceFeatures {
  ask_meridian: boolean;
  export_reports: boolean;
  run_sync: boolean;
  field_mapping_self_service: boolean;
  max_users: number;
}

export interface LlmConfig {
  tier: 1 | 2 | 3;
  model: string;
  notes: string;
}

export interface LicenceManifest {
  valid: boolean | null;
  status: string;
  tenant_id?: string;
  company_name?: string;
  tier?: "starter" | "professional" | "enterprise";
  expiry_date?: string;
  days_remaining?: number;
  enabled_modules: string[];
  enabled_menu_items: string[];
  features: LicenceFeatures;
  llm_config?: LlmConfig;
  last_validated?: string;
}

const DEFAULT_MANIFEST: LicenceManifest = {
  valid: null,
  status: "checking",
  enabled_modules: ["*"],
  enabled_menu_items: [
    "dashboard", "findings", "versions", "analytics", "import", "sync",
    "reports", "stewardship", "contracts", "ask_meridian", "export",
    "user_management", "settings", "licence",
  ],
  features: {
    ask_meridian: true,
    export_reports: true,
    run_sync: true,
    field_mapping_self_service: false,
    max_users: 20,
  },
};

export async function getLicenceManifest(): Promise<LicenceManifest> {
  try {
    const resp = await apiClient.get<LicenceManifest>("/api/v1/licence");
    return resp.data;
  } catch {
    return DEFAULT_MANIFEST;
  }
}

export { DEFAULT_MANIFEST };
