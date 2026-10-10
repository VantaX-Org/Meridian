// frontend/design/shell/DrillLink.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DrillLink } from "./DrillLink";

describe("DrillLink", () => {
  it("builds an object-only href with the current run", () => {
    render(<DrillLink object="material_master" run="v1">Material master</DrillLink>);
    expect(screen.getByText("Material master")).toHaveAttribute("href", "/objects/material_master?run=v1");
  });

  it("builds a dimension href", () => {
    render(<DrillLink object="material_master" dimension="completeness" run="v1">Completeness</DrillLink>);
    expect(screen.getByText("Completeness")).toHaveAttribute(
      "href",
      "/objects/material_master?run=v1&tab=rules&dimension=completeness",
    );
  });

  it("builds a rule href", () => {
    render(<DrillLink object="material_master" ruleId="CHK_001" run="v1">Rule</DrillLink>);
    expect(screen.getByText("Rule")).toHaveAttribute("href", "/objects/material_master/rules/CHK_001?run=v1");
  });

  it("appends extra filters as search params", () => {
    render(
      <DrillLink object="material_master" ruleId="CHK_001" run="v1" filters={{ severity: "critical" }}>
        Failing
      </DrillLink>,
    );
    expect(screen.getByText("Failing")).toHaveAttribute(
      "href",
      "/objects/material_master/rules/CHK_001?run=v1&severity=critical",
    );
  });
});
