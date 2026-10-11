import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Badge } from "./Badge";
import { SeverityDot } from "./SeverityDot";
import { Delta } from "./Delta";
import { ScoreRing } from "./ScoreRing";
import { ErrorState } from "./ErrorState";
import { roundedDelta } from "@/lib/format";

describe("data-display primitives", () => {
  it("Badge hides at zero and caps at 99+", () => {
    const { rerender } = render(<Badge count={0} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    rerender(<Badge count={140} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("SeverityDot labels itself by severity", () => {
    render(<SeverityDot severity="critical" />);
    expect(screen.getByLabelText("critical")).toBeInTheDocument();
  });

  it("Delta renders a signed value", () => {
    render(<Delta value={-3} />);
    expect(screen.getByText("-3.0")).toBeInTheDocument();
  });

  it("Delta of two displayed (one-decimal) scores is the difference of the rounded values, not raw precision", () => {
    render(<Delta value={roundedDelta(74.44, 74.55)} />);
    expect(screen.getByText("+0.2")).toBeInTheDocument();
  });

  it("ScoreRing labels itself with the score", () => {
    render(<ScoreRing score={92} />);
    expect(screen.getByLabelText("Score 92")).toBeInTheDocument();
  });

  it("ErrorState calls onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Failed to load" onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

import { Stat } from "./Stat";
import { Counter } from "./Counter";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

describe("wave 6 readings", () => {
  it("Stat renders legacy string delta, hint and tone bar; href makes it a link", () => {
    const { container, rerender } = render(<Stat label="Rules" value="12" delta="+2" hint="vs last run" tone="no-go" />);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("vs last run")).toBeInTheDocument();
    expect(container.querySelector("[data-tone='no-go']")).toBeTruthy();
    rerender(<Stat label="Rules" value="12" href="/rules" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/rules");
  });

  it("ScoreRing: sizes, meridian only at >=96, '/100' at >=96", () => {
    const { container, rerender } = render(<ScoreRing score={80} size={48} />);
    expect(container.querySelector("line")).toBeNull();
    expect(screen.queryByText("/100")).toBeNull();
    for (const size of [24, 96, 160]) {
      rerender(<ScoreRing score={80} size={size} />);
      expect(container.querySelector("svg")).toHaveAttribute("width", String(size));
    }
    expect(container.querySelector("line")).toBeTruthy();
    expect(screen.getByText("/100")).toBeInTheDocument();
  });

  it("ScoreRing draws with the draw class and the circumference custom property", () => {
    const { container } = render(<ScoreRing score={80} size={96} />);
    const arc = container.querySelector("[data-value]") as SVGElement;
    expect(arc.getAttribute("class")).toContain("m-motion-draw");
    expect(arc.style.getPropertyValue("--m-draw-length")).not.toBe("");
  });

  it("ScoreRing cap shows tick, ghost arc, clamped value and label", () => {
    const { container } = render(<ScoreRing score={96} cap={85} criticals={1} size={160} />);
    expect(container.querySelector("[data-cap]")).toBeTruthy();
    expect(container.querySelector("[data-ghost]")).toBeTruthy();
    expect(screen.getByText("Capped at 85 — 1 critical")).toBeInTheDocument();
    expect(screen.getByLabelText("Score 85")).toBeInTheDocument();
  });

  it("Counter uses the hero token by default", () => {
    render(<Counter value={null} />);
    expect(screen.getByLabelText("No data").style.fontSize).toBe("var(--m-text-hero)");
  });

  it("EmptyState supports ring and stepper ghosts; ErrorState has fixed title and mono message", () => {
    const { container, rerender } = render(<EmptyState title="t" ghost="ring" />);
    expect(container.querySelector("svg line")).toBeTruthy();
    rerender(<EmptyState title="t" ghost="stepper" />);
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
    rerender(<ErrorState message="503 upstream" />);
    expect(screen.getByText("Could not reach the server.")).toBeInTheDocument();
    expect(screen.getByText("503 upstream")).toHaveClass("m-mono");
  });

  it("Skeleton uses the sunken surface", () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).style.background).toContain("--m-sheet-sunken");
  });
});

describe("ErrorState duplicate message", () => {
  it("does not repeat the title when the message is the same sentence", () => {
    render(<ErrorState message="Could not reach the server." />);
    expect(screen.getAllByText(/could not reach the server/i)).toHaveLength(1);
  });
});
