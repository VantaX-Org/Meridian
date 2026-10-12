import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportPage } from "../ReportPage";

describe("ReportPage title", () => {
  it("renders a PageHeader h2, never an h1, with the export menu in the header", () => {
    render(<ReportPage title="Trends" meta="3 runs" narrative="n" charts={<p>chart</p>} exportMenu={<button>Export</button>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Trends" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
  });
});
