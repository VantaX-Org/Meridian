/** Verified survivorship fixture, shaped like api/routes/aletheia_survivorship.py. Keys are synthetic; no value appears. */
import type { Survivorship } from "../aletheia-survivorship";

export const NONE_SURVIVORSHIP = Symbol("not a survivorship path");

const ok = [{ code: "SOURCE_KNOWN", passed: true }, { code: "VALUE_PRESENT", passed: true }, { code: "CONFIDENCE_VALID", passed: true }];

const DATA: Survivorship = {
  domains: [
    { domain: "material_master", verified: 41, rejected: 3 },
    { domain: "sd_customer_master", verified: 18, rejected: 2 },
  ],
  picks: [
    { domain: "material_master", sap_object_key: "MAT-000101", field: "MARA.MTART", field_text: "Material type", recommended_source: "SYS_A", confidence: 0.82, reasoning: "SYS_A holds a value extracted 2026-11-04; 1 of the other 2 sources hold the same value.", verified: true, checks: ok },
    { domain: "material_master", sap_object_key: "MAT-000102", field: "MARA.MATKL", field_text: "Material group", recommended_source: "SYS_Z", confidence: 0, reasoning: "", verified: false, checks: [{ code: "SOURCE_KNOWN", passed: false }, { code: "VALUE_PRESENT", passed: false }, { code: "CONFIDENCE_VALID", passed: true }] },
  ],
};

export function survivorshipRead(path: string): unknown {
  return path === "/aletheia/survivorship" ? DATA : NONE_SURVIVORSHIP;
}
