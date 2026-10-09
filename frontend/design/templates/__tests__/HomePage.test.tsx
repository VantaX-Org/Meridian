// frontend/design/templates/__tests__/HomePage.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-jobs", () => ({ useJobs: () => ({ active: [] }) }));

import { HomePage } from "../HomePage";

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
