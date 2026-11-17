import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("shows title, context and actions", () => {
    render(<PageHeader title="Material master" context="Run 4" actions={<Button variant="primary">Go</Button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Material master" })).toBeTruthy();
    expect(screen.getByText("Run 4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
  });
});
