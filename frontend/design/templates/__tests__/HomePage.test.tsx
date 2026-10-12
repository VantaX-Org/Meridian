// frontend/design/templates/__tests__/HomePage.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-jobs", () => ({ useJobs: () => ({ active: [] }) }));

import { HomePage } from "../HomePage";

const run = { label: "Run 1", runAt: "2026-01-01T00:00:00Z" };

describe("HomePage no-data state", () => {
  it("renders the step sheet, the situation sentence and no verdict number", () => {
    render(
      <HomePage
        persona="lead"
        state="no-data"
        journey={{
          systemsConnected: false,
          configLoaded: false,
          extracted: false,
          complete: false,
          step: { key: "connect", href: "/systems", label: "Connect a system", detail: "Add an SAP system.", actionable: true },
        }}
      />,
    );
    expect(screen.getByText("Get to your first score")).toBeInTheDocument();
    expect(screen.getByTestId("day-one-step")).toBeInTheDocument();
    expect(screen.getByTestId("home-verdict")).toHaveTextContent("No analysis yet. Connect a system and run the first extraction.");
    expect(screen.queryByTestId("home-dqs")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(1); // only the step sheet's primary action
  });
});

describe("HomePage data state", () => {
  it("shows the DQS, a sans verdict sentence and the action link", async () => {
    render(
      <HomePage
        persona="lead"
        state="data"
        verdict={{ dqs: 82.4, sentence: "Material master is ready.", action: { label: "Open objects", href: "/objects" } }}
        run={run}
      />,
    );
    expect(screen.getByTestId("home-dqs").querySelector("[aria-label='82.4']")).not.toBeNull();
    expect(screen.getByTestId("home-verdict-row")).toHaveClass("m-hero");
    const sentence = screen.getByTestId("home-verdict");
    expect(sentence.tagName).toBe("P");
    expect(sentence.style.fontFamily).toBe("");
    expect(screen.getByRole("link", { name: "Open objects" })).toHaveAttribute("href", "/objects");
  });

  it("shows a dash when no module is scored, and no ring", () => {
    const { container } = render(<HomePage persona="lead" state="data" verdict={{ dqs: null, sentence: "x" }} run={run} />);
    expect(screen.getByTestId("home-dqs")).toHaveTextContent("—");
    expect(container.querySelector("svg[role=img]")).toBeNull();
  });

  it("omits the objects column when there is no objects slot", () => {
    render(<HomePage persona="basis" state="data" verdict={{ dqs: 70, sentence: "x" }} run={run} trend={<div data-testid="t" />} />);
    expect(screen.getByTestId("t").parentElement?.className).toContain("@5xl:col-span-12");
  });

  it("loading shows skeletons only", () => {
    render(<HomePage persona="lead" state="loading" />);
    expect(screen.getByTestId("home-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("home-verdict")).toBeNull();
  });

  it("error shows the message with retry", () => {
    render(<HomePage persona="lead" state="error" error={{ message: "boom", onRetry: () => {} }} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
