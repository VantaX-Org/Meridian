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
