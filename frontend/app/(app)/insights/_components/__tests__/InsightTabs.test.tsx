import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightTabs } from "../InsightViews";

const nav = vi.hoisted(() => ({ path: "/insights/owners" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams() }));

afterEach(() => { nav.path = "/insights/owners"; });

describe("InsightTabs", () => {
  it.each(["/insights/owners", "/insights/operations", "/rules/contracts"])("draws no Operate strip on %s (Runs and Fix work dropped it)", (path) => {
    nav.path = path;
    const { container } = render(<InsightTabs />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("link", { name: "Fix work" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Data contracts" })).toBeNull();
  });

  it("keeps the strip of a view whose tabs are one page's sections", () => {
    nav.path = "/insights/trends";
    render(<InsightTabs />);
    expect(screen.getByRole("navigation", { name: "Progress views" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forecast" })).toBeInTheDocument();
  });
});
