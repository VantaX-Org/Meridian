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
import { Counter, formatCount } from "./Counter";
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
    // dash length of the value arc (270 degrees at 80%), so the draw grows from the start
    const dash = parseFloat(arc.getAttribute("stroke-dasharray") ?? "");
    expect(parseFloat(arc.style.getPropertyValue("--m-draw-length"))).toBeCloseTo(dash, 3);
  });

  it("ScoreRing does not label a cap that does not bind", () => {
    render(<ScoreRing score={70} cap={85} size={96} />);
    expect(screen.queryByText(/Capped at/)).toBeNull();
    expect(screen.getByLabelText("Score 70")).toBeInTheDocument();
  });

  it("ScoreRing cap shows tick, ghost arc, clamped value and label", () => {
    const { container } = render(<ScoreRing score={96} cap={85} criticals={1} size={160} />);
    expect(container.querySelector("[data-cap]")).toBeTruthy();
    expect(container.querySelector("[data-ghost]")).toBeTruthy();
    expect(screen.getByText("Capped at 85, 1 critical")).toBeInTheDocument();
    expect(screen.getByLabelText("Score 85, capped from 96, 1 critical")).toBeInTheDocument();
  });

  it("Counter uses the hero token by default", () => {
    render(<Counter value={null} />);
    expect(screen.getByLabelText("No data").style.fontSize).toBe("var(--m-text-hero)");
  });

  it("Counter groups thousands and reserves the width of the grouped number", () => {
    render(<Counter value={34301} decimals={0} />);
    const el = screen.getByLabelText("34,301");
    expect(el.style.minWidth).toBe("6ch");
    expect(formatCount(1008920.5, 1)).toBe("1,008,920.5");
    expect(formatCount(70, 1)).toBe("70.0");
  });

  it("Stat groups a plain numeric value that does not count up", () => {
    render(<Stat label="In flight" value={11151} />);
    expect(screen.getByText("11,151")).toBeInTheDocument();
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
