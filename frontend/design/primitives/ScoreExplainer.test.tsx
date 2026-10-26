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
