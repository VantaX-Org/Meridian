// The palette's native places and ask panel: the same places as the old command line, and the filter that will run.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NlAnswer } from "@/lib/api/v2/step10";
import { NlPanel, placeIndex } from "../commands";

describe("placeIndex", () => {
  it("offers Connect a system and the admin sections only to those allowed", () => {
    const all = placeIndex(() => true);
    expect(all.some((p) => p.id === "connect")).toBe(true);
    expect(all.some((p) => p.id === "admin")).toBe(true);
    const none = placeIndex(() => false);
    expect(none.some((p) => p.id === "connect")).toBe(false);
    expect(none.some((p) => p.id.startsWith("admin"))).toBe(false);
    expect(none.some((p) => p.id === "reports")).toBe(true);
  });
});

describe("NlPanel", () => {
  it("explains how to ask when there is no question", () => {
    render(<NlPanel question={null} answer={undefined} pending={false} failed={false} onOpen={vi.fn()} />);
    expect(screen.getByTestId("nl-panel")).toHaveTextContent("Type a question after the ?");
  });

  it("shows a failure", () => {
    render(<NlPanel question="x" answer={undefined} pending={false} failed onOpen={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The question could not be read.");
  });

  it("shows the filter, the words left out, and opens in Work", () => {
    const onOpen = vi.fn();
    const answer: NlAnswer = { filter: {}, href: "/work", matched: [], explanation: "Open work, all objects.", unmatched_words: ["zorp"], llm_used: false };
    render(<NlPanel question="zorp" answer={answer} pending={false} failed={false} onOpen={onOpen} />);
    expect(screen.getByText("No filter: Open shows the open work.")).toBeInTheDocument();
    expect(screen.getByTestId("nl-explanation")).toHaveTextContent("Open work, all objects.");
    expect(screen.getByTestId("nl-unmatched")).toHaveTextContent("zorp");
    fireEvent.click(screen.getByRole("button", { name: "Open in Work" }));
    expect(onOpen).toHaveBeenCalled();
  });
});
