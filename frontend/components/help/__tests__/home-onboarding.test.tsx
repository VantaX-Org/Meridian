import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeOnboarding } from "../home-onboarding";

let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));
vi.mock("@/hooks/use-first-run-checklist", () => ({
  useFirstRunChecklist: () => ({ loading: false, items: [{ id: "batch", label: "Create a first fix batch", done: false, href: "/fix" }] }),
}));
vi.mock("@/lib/help/storage", () => ({ dismissChecklist: vi.fn(), isChecklistDismissed: () => false, subscribeStorage: () => () => {} }));
vi.mock("@/design", () => ({
  TourOffer: () => null,
  FirstRunChecklist: ({ items }: { items: { label: string }[] }) => <ul>{items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>,
}));

describe("HomeOnboarding", () => {
  it("shows the setup checklist to whoever manages systems", () => {
    allowed = true;
    render(<HomeOnboarding />);
    expect(screen.getByText("Create a first fix batch")).toBeInTheDocument();
  });

  it("hides it from everyone else, viewers included", () => {
    allowed = false;
    render(<HomeOnboarding />);
    expect(screen.queryByText("Create a first fix batch")).toBeNull();
  });
});
