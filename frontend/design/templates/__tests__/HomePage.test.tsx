// frontend/design/templates/__tests__/HomePage.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-jobs", () => ({ useJobs: () => ({ active: [] }) }));

import { HomePage } from "../HomePage";

const run = { id: "v1", label: "Run 1", runAt: "2026-01-01T00:00:00Z" };

describe("HomePage no-data state", () => {
  it("renders the step sheet, the situation sentence and no verdict number", () => {
    render(
      <HomePage
        persona="lead"
        state="empty"
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

  it("names the step under way: a running first run says so and rings First score, even with configuration skipped", () => {
    render(
      <HomePage
        persona="lead"
        state="empty"
        journey={{
          systemsConnected: true,
          configLoaded: false,
          extracted: true,
          complete: false,
          step: { key: "running", href: "/runs/r1", label: "Analysis is running", detail: "Wait.", actionable: true, actionLabel: "Open the job" },
        }}
      />,
    );
    expect(screen.getByTestId("home-verdict")).toHaveTextContent("The first analysis is running.");
    expect(screen.getByText(", current step").parentElement).toHaveTextContent("First score");
    expect(screen.getByRole("link", { name: "Open the job" })).toHaveAttribute("href", "/runs/r1");
  });
});

describe("HomePage data state", () => {
  it("shows the DQS, a sans verdict sentence and the action link", async () => {
    render(
      <HomePage
        persona="lead"
        state="ready"
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

  it("says it is the first run for the object instead of comparing with another object", () => {
    render(<HomePage persona="lead" state="ready" verdict={{ dqs: 70, sentence: "x", firstRun: true, delta: null }} run={run} />);
    expect(screen.getByTestId("home-dqs")).toHaveTextContent("First run for this object");
    expect(screen.getByTestId("home-dqs")).not.toHaveTextContent(/^vs /);
    // The column grows with the numeral and its delta chip instead of clipping them (.m-score-hero: width max-content).
    expect(screen.getByTestId("home-dqs").firstElementChild).toHaveClass("m-score-hero");
  });

  it("shows a dash when no module is scored, and no ring", () => {
    const { container } = render(<HomePage persona="lead" state="ready" verdict={{ dqs: null, sentence: "x" }} run={run} />);
    expect(screen.getByTestId("home-dqs")).toHaveTextContent("—");
    expect(container.querySelector("svg[role=img]")).toBeNull();
  });

  it("sets the next best action right under the hero, before the four sentences", () => {
    render(<HomePage persona="lead" state="ready" verdict={{ dqs: 70, sentence: "x" }} run={run} nextAction={<div data-testid="nba" />} cells={<div data-testid="cells" />} />);
    const nba = screen.getByTestId("nba");
    expect(screen.getByTestId("home-verdict-row").compareDocumentPosition(nba) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nba.compareDocumentPosition(screen.getByTestId("cells")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts the trend in the hero, under the score and its verdict", () => {
    render(<HomePage persona="basis" state="ready" verdict={{ dqs: 70, sentence: "x" }} run={run} trend={<div data-testid="t" />} />);
    const hero = screen.getByTestId("home-verdict-row");
    expect(hero).toContainElement(screen.getByTestId("home-trend"));
    expect(screen.getByTestId("home-trend")).toContainElement(screen.getByTestId("t"));
    expect(screen.getByTestId("home-dqs").compareDocumentPosition(screen.getByTestId("t")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts the aside and the dimension bars right of the score in the hero, and nothing there without them", () => {
    const { rerender } = render(
      <HomePage persona="lead" state="ready" verdict={{ dqs: 70, sentence: "x" }} run={run} aside={<div data-testid="map" />} dimensions={<div data-testid="dims" />} />,
    );
    const hero = screen.getByTestId("home-verdict-row");
    const aside = screen.getByTestId("home-hero-aside");
    expect(hero).toContainElement(aside);
    expect(aside).toContainElement(screen.getByTestId("map"));
    expect(aside).toContainElement(screen.getByTestId("dims"));
    expect(screen.getByTestId("home-dqs").parentElement?.className).toContain("@4xl:col-span-7");
    expect(aside.className).toContain("@4xl:col-span-5");
    rerender(<HomePage persona="lead" state="ready" verdict={{ dqs: 70, sentence: "x" }} run={run} />);
    expect(screen.queryByTestId("home-hero-aside")).toBeNull();
  });

  it("orders the setup notice, hero (with the trend), four sentences, ledger, work row, heatmap, then lists", () => {
    render(
      <HomePage
        persona="lead"
        state="ready"
        verdict={{ dqs: 70, sentence: "x" }}
        run={run}
        cells={<div data-testid="cells" />}
        objects={<div data-testid="ledger" />}
        onboarding={<div data-testid="onboarding" />}
        work={<div data-testid="work" />}
        trend={<div data-testid="trend" />}
        heatmap={<div data-testid="heat" />}
        lists={<div data-testid="lists" />}
      />,
    );
    const order = ["onboarding", "home-verdict-row", "cells", "ledger", "work", "heat", "lists"].map((id) => screen.getByTestId(id));
    order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.getByTestId("home-verdict-row")).toContainElement(screen.getByTestId("trend"));
  });

  it("opsFirst (the Basis home) leads with the work row and the lists, the score after them, each once", () => {
    render(
      <HomePage
        persona="basis"
        state="ready"
        opsFirst
        verdict={{ dqs: 70, sentence: "x" }}
        run={run}
        cells={<div data-testid="cells" />}
        work={<div data-testid="work" />}
        lists={<div data-testid="lists" />}
      />,
    );
    const order = ["work", "lists", "home-verdict-row", "cells"].map((id) => screen.getByTestId(id));
    order.slice(1).forEach((el, i) => expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.getAllByTestId("lists")).toHaveLength(1);
    expect(screen.getAllByTestId("work")).toHaveLength(1);
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
