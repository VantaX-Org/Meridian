// frontend/design/shell/Breadcrumb.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/import",
  useSearchParams: () => new URLSearchParams(""),
}));

import { Breadcrumb, useBreadcrumbScope } from "./Breadcrumb";

describe("Breadcrumb", () => {
  it("renders exactly one h1 for a page with no drill trail, using the nav title", () => {
    render(<Breadcrumb />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Import file");
  });
});

function Scope() {
  useBreadcrumbScope(["14 objects", "run 2026-10-11"]);
  return null;
}

describe("Breadcrumb scope", () => {
  it("renders each scope part as its own element with no middle dot", () => {
    render(<><Breadcrumb /><Scope /></>);
    const parts = screen.getAllByTestId("crumb-scope");
    expect(parts.map((p) => p.textContent)).toEqual(["14 objects", "run 2026-10-11"]);
    expect(document.body.textContent).not.toContain("\u00B7");
  });
});
