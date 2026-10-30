import { describe, expect, it } from "vitest";
import { PERSONA_LABEL, personaOf } from "./hooks";

describe("every role its own persona", () => {
  it.each([
    ["platform_admin", "admin", "Platform admin"],
    ["admin", "admin", "Platform admin"],
    ["analyst", "analyst", "Analyst"],
    ["auditor", "auditor", "Auditor"],
    ["viewer", "viewer", "Viewer"],
    ["programme_lead", "lead", "Programme lead"],
    ["manager", "lead", "Programme lead"],
    ["data_steward", "steward", "Data steward"],
    ["data_owner", "owner", "Data owner"],
    ["sap_basis", "basis", "SAP Basis"],
    ["process_analyst", "process", "Process analyst"],
  ] as const)("%s reads %s (%s)", (role, persona, label) => {
    expect(personaOf(role)).toBe(persona);
    expect(PERSONA_LABEL[personaOf(role)]).toBe(label);
  });

  it("a role it does not know is a viewer, never the programme lead", () => {
    expect(personaOf("someone_new")).toBe("viewer");
  });
});
