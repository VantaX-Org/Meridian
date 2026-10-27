import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pill } from "./Pill";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders an h2 (Breadcrumb owns the h1) with meta, status and actions", () => {
    render(<PageHeader title="Rules" meta="12 rules" status={<Pill tone="go">Ready</Pill>} actions={<button>Run</button>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Rules" })).toBeTruthy();
    expect(screen.getByText("12 rules")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });

  it("shows secondary actions inline from 640px and as a More actions menu below", async () => {
    const onEdit = vi.fn();
    render(<PageHeader title="S" actions={<button>Extract</button>} secondary={<button>Edit</button>}
      more={[{ label: "Edit", onSelect: onEdit }, { label: "Analyse", onSelect: vi.fn(), disabled: true }]} />);
    expect(screen.getByRole("button", { name: "Edit" }).parentElement).toHaveClass("contents", "max-sm:hidden");
    const more = screen.getByRole("button", { name: "More actions" });
    expect(more.closest(".sm\\:hidden")).not.toBeNull();
    await userEvent.click(more);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalled();
  });
});
