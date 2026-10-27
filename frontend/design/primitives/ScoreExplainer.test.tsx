import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreExplainer } from "./ScoreExplainer";

describe("ScoreExplainer links", () => {
  it("underlines its in-text links and colours them with the accent class, not an inline style", async () => {
    render(
      <ScoreExplainer
        score={82}
        band={{ label: "Good", tone: "go" }}
        dimensions={[{ name: "Completeness", weight: 0.25, score: 90 }]}
        rules={[{ ruleId: "MM001", object: "material_master", recordsFailed: 12, weight: 1 }]}
        historyHref="/insights/score"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Explain score 82.0" }));
    for (const name of ["MM001", "Score history"]) {
      const link = await screen.findByRole("link", { name });
      expect(link).toHaveClass("underline", "underline-offset-2", "m-ink-accent");
      expect(link.getAttribute("style")).toBeNull();
    }
  });
});

describe("ScoreExplainer breakdown", () => {
  const props = {
    band: { label: "At risk", tone: "at-risk" as const },
    dimensions: [
      { name: "Completeness", weight: 0.25, score: 90 },
      { name: "Accuracy", weight: 0.25, score: 80 },
    ],
    rules: [
      { ruleId: "MM001", object: "material_master", recordsFailed: 12, weight: 1, passRate: 98.46 },
      { ruleId: "MM002", object: "material_master", recordsFailed: 3, weight: 0.5 },
    ],
    historyHref: "/insights/trends",
    run: "run-1",
    recordsHref: "/runs/run-1?tab=findings",
  };

  it("lists the failing checks with their pass rates, each linked to its failing records", async () => {
    render(<ScoreExplainer score={82} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain score 82.0" }));
    const mm1 = await screen.findByRole("link", { name: "MM001" });
    expect(mm1).toHaveAttribute("href", "/objects/material_master?run=run-1&tab=records&check_id=MM001");
    expect(mm1.closest("li")).toHaveTextContent("12 records, 98.4% pass");
    // a check without a known pass rate says nothing about one
    expect(screen.getByRole("link", { name: "MM002" }).closest("li")).not.toHaveTextContent("pass");
    expect(screen.getByRole("link", { name: "Open failing records" })).toHaveAttribute("href", "/runs/run-1?tab=findings");
  });

  it("states the critical caps, and that none applied when the score is uncapped", async () => {
    render(<ScoreExplainer score={82} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain score 82.0" }));
    expect(await screen.findByTestId("score-caps")).toHaveTextContent(
      "No cap applied. Critical caps: one critical failure caps the score at 85, two or more at 70.",
    );
  });

  it("names the cap that applied", async () => {
    render(<ScoreExplainer score={88} cap={85} capReason="MM001 fails" {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Explain score/ }));
    expect(await screen.findByText(/Capped at 85.0: MM001 fails/)).toBeInTheDocument();
    expect(screen.getByTestId("score-caps")).toHaveTextContent(/^Critical caps: one critical failure caps the score at 85/);
  });

  it("offers no records link when there is none to open", async () => {
    render(<ScoreExplainer score={82} {...props} recordsHref={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain score 82.0" }));
    await screen.findByRole("link", { name: "Score history" });
    expect(screen.queryByRole("link", { name: "Open failing records" })).not.toBeInTheDocument();
  });
});
