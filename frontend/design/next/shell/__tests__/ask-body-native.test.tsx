import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { AskDone, AskEvidence, AskStreamHandlers } from "@/lib/api/v2/assistant";
import { AskBodyNative, citeFacts, type AskAnswer } from "../AskBodyNative";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const S = vi.hoisted(() => ({ post: vi.fn(), stream: vi.fn(), sugg: vi.fn() }));
vi.mock("@/lib/api/v2/object", async (orig) => ({ ...(await orig<object>()), v2Post: S.post }));
vi.mock("@/lib/api/v2/assistant", async (orig) => ({ ...(await orig<object>()), askStream: S.stream, getSuggestions: S.sugg }));

const answer: AskAnswer = {
  answer: "Completeness of the material master holds the score at 81. Validity is 74.",
  intent: "score_drivers",
  data: [{ label: "Completeness", value: 81 }, { label: "Validity", value: 74 }, { label: "Accuracy", value: 60 }],
  chart: "bar",
  links: [{ label: "Open the material master", href: "/o/ecc/material_master" }],
  phrased: true,
  version_id: "v-1",
  facts: [
    { statement: "Completeness is 81", value: 81, source: "run v-1", href: "/o/ecc/material_master", checks: [{ check_id: "MM-001" }] },
    { statement: "Validity is 74", value: 74, source: "run v-1", checks: [{ check_id: "MM-002" }] },
    { statement: "Nothing blocks go-live", value: null, source: "run v-1", checks: [] },
  ],
  coverage: 0.9,
  grounded: true,
  citations: [{ check_id: "MM-001", module: "material_master", href: "/r/MM-001" }, { check_id: "MM-009", module: "material_master", href: "/r/MM-009" }],
};
const done = (a: AskAnswer) => ({ ...a, ai: a.phrased } as unknown as AskDone);
const evidence = (a: AskAnswer) => ({ intent: a.intent, version_id: a.version_id ?? null, facts: a.facts, citations: a.citations, data: a.data ?? null, chart: a.chart ?? null, links: a.links, coverage: a.coverage, grounded: a.grounded } as unknown as AskEvidence);
/** A stream that plays evidence, one token and done. */
const play = (a: AskAnswer) => S.stream.mockImplementation(async (_b: unknown, h: AskStreamHandlers) => { h.onEvidence(evidence(a)); h.onToken("Completeness"); h.onDone(done(a)); });
const ask = async (q: string) => {
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: q } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  return screen.findByTestId("ask-answer");
};

beforeEach(() => { S.post.mockReset(); S.stream.mockReset(); S.sugg.mockReset(); S.sugg.mockResolvedValue([]); });

describe("landing", () => {
  it("shows the promise, scope heading, subtext and the fallback chips", () => {
    renderWithQuery(<AskBodyNative scope="the material master" />);
    expect(screen.getByText("I only say what I can prove, and I show where every number comes from.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ask Aletheia about the material master" })).toBeInTheDocument();
    expect(screen.getByText("Answers come from this run's verified facts. Never a probability, never a guess.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is holding the score down?" })).toBeInTheDocument();
  });

  it("uses the chips from /assistant/suggestions when it answers", async () => {
    S.sugg.mockResolvedValue(["Which rule fails most?"]);
    renderWithQuery(<AskBodyNative />);
    expect(await screen.findByRole("button", { name: "Which rule fails most?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is the money at risk?" })).toBeNull();
  });

  it("keeps the fixed chips when suggestions fail", async () => {
    S.sugg.mockRejectedValue(new Error("down"));
    renderWithQuery(<AskBodyNative />);
    await waitFor(() => expect(S.sugg).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "What did Aletheia find?" })).toBeInTheDocument();
  });

  it("hero icon only when hero, and '/' focuses the input but not inside a field", () => {
    const { container } = renderWithQuery(<AskBodyNative hero={false} />);
    expect(container.querySelector(".nx-ask-hero")).toBeNull();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByLabelText("Your question")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "a" } });
    fireEvent.keyDown(screen.getByLabelText("Your question"), { key: "/" });
    expect(screen.getByLabelText("Your question")).toHaveValue("a");
  });

  it("Ask is disabled when empty and Cmd+K is not bound", () => {
    renderWithQuery(<AskBodyNative />);
    expect(screen.getByRole("button", { name: "Ask" })).toHaveAttribute("aria-disabled", "true");
    const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true, bubbles: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("a grounded answer", () => {
  it("streams: the fact graph appears on evidence, then the six sections on done", async () => {
    play(answer);
    renderWithQuery(<AskBodyNative />);
    const a = await ask("What holds the score?");
    expect(S.stream).toHaveBeenCalledWith({ question: "What holds the score?", scope: "current" }, expect.anything());
    expect(S.post).not.toHaveBeenCalledWith("/assistant/ask", expect.anything());
    const graph = within(a).getByTestId("fact-graph");
    expect(graph).toHaveTextContent("Fact graph");
    expect(graph).toHaveTextContent("3 facts answer it");
    expect(graph).toHaveTextContent("coverage 0.90");
    expect(within(graph).getAllByRole("button")).toHaveLength(3);
    expect(within(graph).getByTitle("F1: Completeness is 81")).toBeInTheDocument();
    expect(a).toHaveTextContent("Completeness of the material master holds the score at 81");
    expect(a).toHaveTextContent("Reworded by the model from these facts");
    expect(a).toHaveTextContent("Verified, coverage 0.90, 3 facts, grounded");
    expect(a).toHaveTextContent("v-1");
    expect(a).toHaveTextContent("On the record");
    expect(a).toHaveTextContent("Source: run v-1");
    expect(a).toHaveTextContent("Also cited:");
    expect(a).toHaveTextContent("MM-009");
    expect(a.querySelector("[data-viz]")).not.toBeNull();
    expect(a).toHaveTextContent("Open the material master");
  });

  it("shows the pending facts grid and streamed text before done", async () => {
    let finish: () => void = () => {};
    S.stream.mockImplementation((_b: unknown, h: AskStreamHandlers) => new Promise<void>((res) => {
      h.onEvidence(evidence(answer)); h.onToken("Completeness is");
      finish = () => { h.onDone(done(answer)); res(); };
    }));
    renderWithQuery(<AskBodyNative />);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const p = await screen.findByTestId("ask-pending");
    await waitFor(() => expect(p).toHaveTextContent("Reading 3 facts"));
    expect(p).toHaveTextContent("Completeness is");
    expect(screen.getByRole("button", { name: "Ask" })).toHaveAttribute("aria-disabled", "true");
    act(() => finish());
    expect(await screen.findByTestId("ask-answer")).toBeInTheDocument();
  });

  it("adds F-n citations only where a fact's number appears, and a click highlights the record row", async () => {
    play(answer);
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    const cites = a.querySelectorAll("button.nx-ask-cite");
    expect(cites).toHaveLength(2);
    expect(cites[0]).toHaveTextContent("F1");
    fireEvent.click(cites[0]);
    const row = a.querySelector("#ask-0-fact-1");
    expect(row).toHaveAttribute("data-hot", "1");
    expect(a.querySelector("#ask-0-fact-2")).not.toHaveAttribute("data-hot");
    expect(a.querySelectorAll("[data-cited]").length).toBeGreaterThan(0);
  });

  it("a fact cell click also highlights its row, and a check chip links to its citation", async () => {
    play(answer);
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    fireEvent.click(within(a).getByTitle("F3: Nothing blocks go-live"));
    expect(a.querySelector("#ask-0-fact-3")).toHaveAttribute("data-hot", "1");
    expect(within(a).getByText("MM-001").closest("a")).toHaveAttribute("href", expect.stringContaining("/r/MM-001"));
    expect(within(a).getByText("Completeness is 81").closest("a")).toHaveAttribute("href", expect.stringContaining("/o/ecc/material_master"));
  });

  it("caps the grid at 24 cells with a +k cell", async () => {
    const many = { ...answer, facts: Array.from({ length: 30 }, (_, i) => ({ statement: `Fact ${i}`, value: i, source: "s", checks: [] })) };
    play(many);
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    const graph = within(a).getByTestId("fact-graph");
    expect(within(graph).getAllByRole("button")).toHaveLength(23);
    expect(graph).toHaveTextContent("+7");
  });

  it("an answer with no facts says so", async () => {
    play({ ...answer, facts: [], data: null, chart: null });
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    expect(a).toHaveTextContent("No facts in this run speak to that.");
    expect(a.querySelector("[data-viz]")).toBeNull();
  });

  it("falls back to the plain endpoint when the stream fails before evidence", async () => {
    S.stream.mockRejectedValue(new Error("no stream"));
    S.post.mockResolvedValue(answer);
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    expect(S.post).toHaveBeenCalledWith("/assistant/ask", { question: "Q", scope: "current" });
    expect(a).toHaveTextContent("Verified");
  });

  it("passes module and version to the stream", async () => {
    play(answer);
    renderWithQuery(<AskBodyNative module="material_master" versionId="v-9" />);
    await ask("Q");
    expect(S.stream).toHaveBeenCalledWith({ question: "Q", scope: "current", version_id: "v-9", module: "material_master" }, expect.anything());
  });
});

describe("a refusal", () => {
  const refused = { ...answer, grounded: false };
  it("withholds prose and viz but keeps the facts, verdict and feedback", async () => {
    play(refused);
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Why?");
    expect(a).toHaveAttribute("data-refused", "1");
    expect(a).not.toHaveTextContent("holds the score at 81");
    expect(a).toHaveTextContent("Fact graph, withheld");
    expect(a).toHaveTextContent("Withheld");
    expect(a).toHaveTextContent("The numbers in the draft did not match this run's facts, so Aletheia withheld it.");
    expect(a).toHaveTextContent("Withheld, coverage 0.90, 3 facts, not grounded");
    expect(a).toHaveTextContent("On the record (the draft was withheld)");
    expect(a.querySelector("[data-viz]")).toBeNull();
    expect(a.querySelector("button.nx-ask-cite")).toBeNull();
    expect(within(a).getByRole("button", { name: "Helpful" })).toBeInTheDocument();
  });

  it("an empty answer is a refusal even when grounded", async () => {
    play({ ...answer, answer: "  " });
    renderWithQuery(<AskBodyNative />);
    expect(await ask("Q")).toHaveAttribute("data-refused", "1");
  });
});

describe("errors and feedback", () => {
  it("a failed question shows the error and Try again re-asks the same question", async () => {
    S.stream.mockRejectedValueOnce(new Error("x")).mockImplementationOnce(async (_b: unknown, h: AskStreamHandlers) => { h.onEvidence(evidence(answer)); h.onDone(done(answer)); });
    S.post.mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<AskBodyNative />);
    fireEvent.click(screen.getByRole("button", { name: "What is the money at risk?" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("ask-answer")).toBeInTheDocument();
    expect(S.stream).toHaveBeenLastCalledWith({ question: "What is the money at risk?", scope: "current" }, expect.anything());
  });

  it("records a vote once and shows thanks", async () => {
    play(answer);
    S.post.mockResolvedValue({});
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    fireEvent.click(within(a).getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(S.post).toHaveBeenCalledWith("/insights/feedback", { surface: "aletheia", run_id: "v-1", vote: "down" }));
    expect(await within(a).findByRole("status")).toHaveTextContent("Thanks, your feedback is recorded.");
    expect(within(a).queryByRole("button", { name: "Helpful" })).toBeNull();
  });

  it("a failed vote shows an inline error and keeps the buttons", async () => {
    play(answer);
    S.post.mockRejectedValue(new Error("nope"));
    renderWithQuery(<AskBodyNative />);
    const a = await ask("Q");
    fireEvent.click(within(a).getByRole("button", { name: "Helpful" }));
    expect(await within(a).findByRole("alert")).toBeInTheDocument();
    expect(within(a).getByRole("button", { name: "Helpful" })).toBeEnabled();
  });
});

describe("LivingVizCard", () => {
  it.each([
    ["ranked", answer, "Biggest first"],
    ["trend", { ...answer, chart: "line" as const, data: [{ label: "2026-01-01", value: 70 }, { label: "2026-02-01", value: 75 }, { label: "2026-03-01", value: 81 }] }, "How it moved"],
    ["stat", { ...answer, chart: null, data: [{ label: "Score", value: 81 }] }, "Score"],
  ])("renders the %s card with its title and source line", async (kind, a, title) => {
    play(a);
    renderWithQuery(<AskBodyNative />);
    const root = await ask("Q");
    const card = root.querySelector(`[data-viz="${kind}"]`) as HTMLElement;
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent(title);
    expect(card).toHaveTextContent("score_drivers, 3 facts, v-1, run v-1");
  });

  it("the source line says current run without a version", async () => {
    play({ ...answer, version_id: null, facts: [{ ...answer.facts[0], source: "" }] });
    renderWithQuery(<AskBodyNative />);
    const root = await ask("Q");
    expect(root.querySelector("[data-viz]")).toHaveTextContent("score_drivers, 1 facts, current run");
  });

  it("ranked 'see all in the record' appears when rows are cut and scrolls to the record", async () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: 100 - i }));
    play({ ...answer, data });
    renderWithQuery(<AskBodyNative />);
    const root = await ask("Q");
    const scroll = vi.fn();
    const rec = root.querySelector("#ask-0-record") as HTMLElement;
    rec.scrollIntoView = scroll;
    fireEvent.click(within(root).getByRole("button", { name: "see all in the record" }));
    expect(scroll).toHaveBeenCalled();
  });
});

describe("citeFacts", () => {
  const f = (value: number | null) => ({ statement: "s", value, source: "x", checks: [] });
  it("cites the first whole-number match and never a partial one", () => {
    const r = citeFacts("Score is 81 and 181 rows, 8.1 too.", [f(81), f(8), f(null)]);
    expect([...r.cited]).toEqual([1]);
    expect(r.parts).toEqual(["Score is 81", 1, " and 181 rows, 8.1 too."]);
  });
  it("matches a percent and decimals", () => {
    expect([...citeFacts("Coverage 0.9 and 12%.", [f(0.9), f(12)]).cited]).toEqual([1, 2]);
  });
  it("cites nothing when no number matches", () => {
    expect(citeFacts("No figures here.", [f(5)]).cited.size).toBe(0);
  });
});
