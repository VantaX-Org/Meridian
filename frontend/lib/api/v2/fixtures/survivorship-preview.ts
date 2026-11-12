/**
 * Fixture for POST /survivorship-rules/preview: the output of the real preview service over four synthetic material
 * clusters (field texts, lengths and check tables come from the repo's ECC dictionary, value sets from the SAP standard
 * baseline). The record keys and values are synthetic.
 */
import type { SurvivorshipPreview } from "../designer";

export const NONE_SURVIVORSHIP_PREVIEW = Symbol("none-survivorship-preview");

const DATA = {
  "clusters_scanned": 4,
  "records_changed": 3,
  "values_changed": 6,
  "invalid_values": 2,
  "attributes": [
    {
      "field": "MAKT-MAKTX",
      "changed": 2,
      "in_dictionary": true,
      "table": "MAKT",
      "text": "Material description",
      "length": 40,
      "check_table": null,
      "fixed_values": 0,
      "check_status": "checked",
      "invalid": 0,
      "invalid_reasons": {} as Record<string, number>,
      "invalid_samples": []
    },
    {
      "field": "MARA-MATKL",
      "changed": 2,
      "in_dictionary": true,
      "table": "MARA",
      "text": "Material Group",
      "length": 9,
      "check_table": "T023",
      "fixed_values": 0,
      "check_status": "checked",
      "invalid": 1,
      "invalid_reasons": {
        "check_table": 1
      },
      "invalid_samples": [
        "ZZ99"
      ]
    },
    {
      "field": "MARA-MEINS",
      "changed": 2,
      "in_dictionary": true,
      "table": "MARA",
      "text": "Base Unit of Measure",
      "length": 3,
      "check_table": "T006",
      "fixed_values": 0,
      "check_status": "checked",
      "invalid": 1,
      "invalid_reasons": {
        "check_table": 1
      },
      "invalid_samples": [
        "KGS"
      ]
    }
  ],
  "samples": [
    {
      "golden_id": "gr-1",
      "key": "MATNR=005001",
      "field": "MARA-MEINS",
      "before": "EA",
      "after": "PC",
      "rule": "most_recent",
      "winner_key": "MATNR=006001",
      "winner_system": "SYS_B"
    },
    {
      "golden_id": "gr-1",
      "key": "MATNR=005001",
      "field": "MARA-MATKL",
      "before": "001",
      "after": "002",
      "rule": "most_recent",
      "winner_key": "MATNR=006001",
      "winner_system": "SYS_B"
    },
    {
      "golden_id": "gr-2",
      "key": "MATNR=005002",
      "field": "MARA-MEINS",
      "before": "KG",
      "after": "KGS",
      "rule": "most_recent",
      "winner_key": "MATNR=006002",
      "winner_system": "SYS_B"
    },
    {
      "golden_id": "gr-2",
      "key": "MATNR=005002",
      "field": "MAKT-MAKTX",
      "before": "Valve seat",
      "after": "Valve",
      "rule": "most_complete",
      "winner_key": "MATNR=006002",
      "winner_system": "SYS_B"
    },
    {
      "golden_id": "gr-3",
      "key": "MATNR=005003",
      "field": "MARA-MATKL",
      "before": "004",
      "after": "ZZ99",
      "rule": "most_recent",
      "winner_key": "MATNR=006003",
      "winner_system": "SYS_B"
    },
    {
      "golden_id": "gr-3",
      "key": "MATNR=005003",
      "field": "MAKT-MAKTX",
      "before": "Bolt",
      "after": "Bolt M12 x 40 zinc plated",
      "rule": "most_complete",
      "winner_key": "MATNR=006003",
      "winner_system": "SYS_B"
    }
  ],
  "domain": "material_master",
  "clusters_total": 4,
  "capped": false,
  "cap": 500,
  "value_set_source": "baseline"
} satisfies SurvivorshipPreview;
const PREVIEW: SurvivorshipPreview = DATA;

export function survivorshipPreviewWrite(method: string, path: string, body?: unknown): SurvivorshipPreview | typeof NONE_SURVIVORSHIP_PREVIEW {
  if (method !== "POST" || path.split("?")[0] !== "/survivorship-rules/preview") return NONE_SURVIVORSHIP_PREVIEW;
  const domain = typeof body === "object" && body !== null && "domain" in body ? String(body.domain) : "";
  if (domain === PREVIEW.domain) return PREVIEW;
  return { ...PREVIEW, domain, clusters_total: 0, clusters_scanned: 0, records_changed: 0, values_changed: 0, invalid_values: 0, value_set_source: "none", attributes: [], samples: [] };
}
