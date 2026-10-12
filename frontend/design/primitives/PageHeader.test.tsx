import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pill } from "./Pill";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders one h1 with meta, status and actions", () => {
    render(<PageHeader title="Rules" meta="12 rules" status={<Pill tone="go">Ready</Pill>} actions={<button>Run</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Rules" })).toBeTruthy();
    expect(screen.getByText("12 rules")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });
});
