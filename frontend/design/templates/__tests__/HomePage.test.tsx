// frontend/design/templates/__tests__/HomePage.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-jobs", () => ({ useJobs: () => ({ active: [] }) }));

import { HomePage, InstrumentPanel } from "../HomePage";

describe("HomePage no-data state", () => {
  it("renders the step sheet and no work tiles", () => {
    render(
      <HomePage
        persona="lead"
        state="no-data"
        verdict={{ sentence1: "No run has finished yet." }}
        journey={{
          systemsConnected: false,
          configLoaded: false,
          extracted: false,
          complete: false,
          step: { key: "connect", href: "/systems", label: "Connect a system", detail: "Add an SAP system.", actionable: true },
        }}
      />,
    );
    expect(screen.getByTestId("day-one-step")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(1); // only the step sheet's primary action
  });
});

describe("HomePage data state", () => {
  it("renders every work tile with an href", () => {
    render(
      <HomePage
        persona="lead"
        state="data"
        verdict={{ sentence1: "Material master is ready.", sentence2: "Business partner needs attention." }}
        run={{ id: "v1", label: "Run 1", runAt: "2026-01-01" }}
        tiles={
          <div>
            <a href="/a">Tile A</a>
            <a href="/b">Tile B</a>
          </div>
        }
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href");
    }
  });

  it("renders the headline as a plain paragraph, not inside a Stat", () => {
    render(
      <HomePage
        persona="lead"
        state="data"
        verdict={{ sentence1: "Material master is ready." }}
        run={{ id: "v1", label: "Run 1", runAt: "2026-01-01" }}
      />,
    );
    const headline = screen.getByText("Material master is ready.");
    expect(headline.tagName).toBe("P");
    expect(headline.closest('[data-component="Stat"]')).toBeNull();
  });
});

describe("HomePage fresh install vs data", () => {
  it("fresh install shows the stepper card, a ghost ring and the Situation sentence", () => {
    const { container } = render(<HomePage persona="lead" state="no-data" verdict={{ sentence1: "Zero modules scored.", sentence2: "Second sentence." }} journey={{ systemsConnected: false, configLoaded: false, extracted: false, complete: false, step: null }} />);
    expect(screen.getByText("Get to your first score")).toBeInTheDocument();
    expect(container.querySelector('[data-ghost="ring"]')).not.toBeNull();
    expect(screen.getByTestId("home-verdict")).toHaveTextContent("No analysis yet. Connect a system and run the first extraction.");
    expect(screen.queryByText("Zero modules scored.")).toBeNull();
    expect(screen.queryByText("Second sentence.")).toBeNull();
    expect(container.querySelector("[role=img][aria-label^=Score]")).toBeNull();
    expect(screen.getByText("Preview").closest("[aria-hidden]")).toBeNull();
  });

  it("hero shows placeholders when trend, dimensions and score are missing", () => {
    render(
      <HomePage
        persona="lead" state="data" verdict={{ sentence1: "x" }}
        panel={<InstrumentPanel dqs={null} delta={null} severity={{ critical: 0, high: 0, medium: 0, low: 0 }} trendPoints={[]} dimensionPoints={[]} heatmapCells={[]} heatmapRows={[]} heatmapCols={[]} versionId="v1" />}
      />,
    );
    expect(screen.getByText("No score for this run.")).toBeInTheDocument();
    expect(screen.getByText("Trend appears after the second run.")).toBeInTheDocument();
    expect(screen.getByText("No dimension scores for this run.")).toBeInTheDocument();
  });

  it("with data the verdict is serif and the hero has a 160 ring with its cap", () => {
    const { container } = render(
      <HomePage
        persona="lead"
        state="data"
        verdict={{ sentence1: "Material master is ready." }}
        run={{ id: "v1", label: "Run 1", runAt: "2026-01-01" }}
        panel={
          <InstrumentPanel
            dqs={70} delta={null} cap={70} criticals={3} severity={{ critical: 3, high: 0, medium: 0, low: 0 }}
            trendPoints={[]} dimensionPoints={[]} heatmapCells={[]} heatmapRows={[]} heatmapCols={[]} versionId="v1"
          />
        }
      />,
    );
    expect(screen.getByTestId("home-verdict").style.fontFamily).toContain("--m-font-display");
    const ring = container.querySelector("svg[role=img][aria-label^=Score]");
    expect(ring).toHaveAttribute("width", "160");
    expect(container.querySelector("[data-cap]")).not.toBeNull();
    expect(container.querySelector('[data-ghost="ring"]')).toBeNull();
  });

  it("loading shows skeletons only", () => {
    render(<HomePage persona="lead" state="loading" />);
    expect(screen.getByTestId("home-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("home-verdict")).toBeNull();
  });
});
