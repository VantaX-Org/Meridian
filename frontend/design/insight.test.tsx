import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiSummary } from "./primitives/AiSummary";
import { ScoreExplainer } from "./primitives/ScoreExplainer";
import { InsightHeader } from "./templates/InsightHeader";
import { NextActions } from "./templates/NextActions";
import { Funnel } from "./charts/Funnel";
import { Pareto } from "./charts/Pareto";
import { Line } from "./charts/Line";

const cell = (s: string) => ({ sentence: s, href: "/x" });

describe("AiSummary", () => {
  it("shows the deterministic fallback when the LLM is not ok, even with model text", () => {
    render(<AiSummary llmOk={false} text="model words" fallback="rule words" />);
    expect(screen.getByText(/AI summary off/)).toBeTruthy();
    expect(screen.getByText("rule words")).toBeTruthy();
    expect(screen.queryByText("model words")).toBeNull();
  });
  it("shows model text and the aggregates-only footer when ok", () => {
    render(<AiSummary llmOk text="model words" fallback="rule words" findingsCount={12} runId="r1" />);
    expect(screen.getByText("model words")).toBeTruthy();
    expect(screen.getByText(/Generated from 12 findings/)).toBeTruthy();
    expect(screen.getByText(/aggregates only/)).toBeTruthy();
  });
  it("treats unknown health as off and offers thumbs only with a handler", () => {
    const onFeedback = vi.fn();
    const { rerender } = render(<AiSummary llmOk={undefined} text="t" fallback="f" />);
    expect(screen.getByText("f")).toBeTruthy();
    rerender(<AiSummary llmOk text="t" fallback="f" onFeedback={onFeedback} />);
    fireEvent.click(screen.getByLabelText("Helpful"));
    expect(onFeedback).toHaveBeenCalledWith("up");
  });
});

describe("InsightHeader", () => {
  it("renders four cells as links to evidence and the next action", () => {
    render(
      <InsightHeader
        situation={cell("No runs yet.")}
        changed={cell("Nothing to compare yet.")}
        why={cell("Without a run there is no score.")}
        next={{ sentence: "Connect a system.", href: "/systems", action: { label: "Connect", href: "/systems", impact: "2 minutes" } }}
      />,
    );
    expect(screen.getByText("No runs yet.").closest("a")?.getAttribute("href")).toBe("/x");
    expect(screen.getByText("Connect").closest("a")?.getAttribute("href")).toBe("/systems");
    expect(screen.getByText("2 minutes")).toBeTruthy();
  });
  it("shows skeletons, not sentences, while loading", () => {
    render(<InsightHeader situation={cell("S")} changed={cell("C")} why={cell("W")} next={cell("N")} loading />);
    expect(screen.queryByText("S")).toBeNull();
  });
});

describe("NextActions", () => {
  it("shows the empty state", () => {
    render(<NextActions actions={[]} />);
    expect(screen.getByText("Nothing to do yet. Actions appear once a run has findings.")).toBeTruthy();
  });
  it("caps at five ranked cards", () => {
    const actions = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, title: `T${i}`, verb: "Open", why: "w" }));
    render(<NextActions actions={actions} />);
    expect(screen.getAllByText("Open")).toHaveLength(5);
    expect(screen.getByLabelText("Rank 5")).toBeTruthy();
  });
});

describe("ScoreExplainer", () => {
  it("opens with contribution table and top rules ranked by failed x weight", () => {
    render(
      <ScoreExplainer
        score={72}
        band={{ label: "At risk", tone: "at-risk" }}
        dimensions={[{ name: "Completeness", weight: 0.25, score: 80 }]}
        cap={{ value: 85, reason: "one critical failure" }}
        rules={[
          { ruleId: "MM-001", object: "material_master", recordsFailed: 10, weight: 1 },
          { ruleId: "MM-002", object: "material_master", recordsFailed: 5, weight: 5 },
        ]}
        historyHref="/runs"
      />,
    );
    fireEvent.click(screen.getByLabelText("Explain score 72"));
    expect(screen.getByText("20.0")).toBeTruthy();
    expect(screen.getByText(/Capped at 85/)).toBeTruthy();
    const ids = screen.getAllByText(/MM-00/).map((n) => n.textContent);
    expect(ids).toEqual(["MM-002", "MM-001"]);
  });
});

describe("charts", () => {
  it("Funnel shows kept percentage per stage", () => {
    render(<Funnel stages={[{ label: "Extracted", value: 200 }, { label: "Passed", value: 150 }]} />);
    expect(screen.getByLabelText("Passed: 150, 75% of previous stage")).toBeTruthy();
  });
  it("Pareto and annotated Line render", () => {
    const data = [{ x: "a", y: 1 }, { x: "b", y: 9 }];
    expect(render(<Pareto data={data} />).container.querySelector(".recharts-responsive-container")).toBeTruthy();
    expect(render(<Line data={data} annotations={[{ x: "a", label: "Rule change" }]} />).container.querySelector(".recharts-responsive-container")).toBeTruthy();
  });
});
