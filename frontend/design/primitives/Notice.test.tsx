import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "./Notice";

describe("Notice", () => {
  it("announces danger and warning as alerts", () => {
    render(<Notice tone="danger" title="Broken">Body</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("Broken");
  });
  it("uses a status role for info and renders the action slot", () => {
    render(<Notice action={<button>Undo</button>}>Body</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Body");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});
