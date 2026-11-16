import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, Skeleton } from "./states";

describe("states", () => {
  it("empty state shows heading and body", () => {
    render(<EmptyState heading="No rule fails" body="Nothing to fix" />);
    expect(screen.getByRole("status").textContent).toContain("No rule fails");
  });
  it("error state offers a retry", () => {
    const retry = vi.fn();
    render(<ErrorState heading="Could not load" retryLabel="Try again" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("skeleton is a labelled status", () => {
    render(<Skeleton label="Loading" lines={3} />);
    expect(screen.getByRole("status", { name: "Loading" }).children).toHaveLength(3);
  });
});
