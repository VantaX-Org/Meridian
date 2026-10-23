// frontend/design/shell/Breadcrumb.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/import",
  useSearchParams: () => new URLSearchParams(""),
}));

import { PageHeader } from "../primitives/PageHeader";
import { Breadcrumb, useBreadcrumbScope, useBreadcrumbTitle } from "./Breadcrumb";

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

  it("hides the scope when the page draws its own title, so the bar can collapse", () => {
    render(<><Breadcrumb /><Scope /><PageHeader title="Objects" meta="14 objects" /></>);
    for (const part of screen.getAllByTestId("crumb-scope")) expect(part).toHaveClass("sr-only");
  });
});

function Detail({ name }: { name: string | null }) {
  useBreadcrumbTitle(name ? { label: name, parent: { label: "Systems", href: "/systems" } } : null);
  return null;
}

describe("Breadcrumb detail title", () => {
  it("uses the entity's name as the one h1 with its list page as the crumb before it, and clears on unmount", () => {
    const view = render(<><Breadcrumb /><Detail name="ECC Prod" /></>);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("ECC Prod");
    expect(screen.getByRole("link", { name: "Systems" })).toHaveAttribute("href", "/systems");
    view.rerender(<><Breadcrumb /><Detail name={null} /></>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Import file");
  });
});
