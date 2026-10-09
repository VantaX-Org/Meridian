// frontend/design/shell/Breadcrumb.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/import",
  useSearchParams: () => new URLSearchParams(""),
}));

import { Breadcrumb } from "./Breadcrumb";

describe("Breadcrumb", () => {
  it("renders exactly one h1 for a page with no drill trail, using the nav title", () => {
    render(<Breadcrumb />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Import file");
  });
});
