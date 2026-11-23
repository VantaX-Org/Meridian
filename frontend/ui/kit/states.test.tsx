import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChartSkeleton, EmptyState, ErrorState, GridSkeleton, HeroSkeleton, Skeleton } from "./states";

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
  it("GridSkeleton draws a header plus rows of cells", () => {
    const { container } = render(<GridSkeleton rows={3} cols={2} label="Loading rules" />);
    expect(screen.getByRole("status", { name: "Loading rules" })).toBeTruthy();
    expect(container.querySelectorAll(".mx-skel")).toHaveLength(8);
    expect(container.querySelectorAll(".mx-skel[data-head]")).toHaveLength(2);
  });
  it("ChartSkeleton and HeroSkeleton are status regions", () => {
    render(<><ChartSkeleton label="Loading chart" height={80} /><HeroSkeleton label="Loading score" /></>);
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading score" })).toBeTruthy();
  });
  it("EmptyState has no illustration and carries its action", () => {
    render(<EmptyState heading="No runs yet." action={<button>Start a run</button>} />);
    expect(screen.getByRole("button", { name: "Start a run" })).toBeTruthy();
    expect(document.querySelector("svg, img")).toBeNull();
  });
  it("ErrorState names the request and keeps the last good data", () => {
    const retry = vi.fn();
    render(<ErrorState request="Score by run" onRetry={retry} stale={<p>Last good: 82</p>} />);
    expect(screen.getByRole("alert").textContent).toContain("Score by run did not load.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByText("Last good: 82")).toBeTruthy();
  });
});
