import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AskAnswer } from "../../lib/api/assistant";

const api = vi.hoisted(() => ({ askMeridian: vi.fn() }));
vi.mock("../../lib/api/assistant", () => api);
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("run=run-1") }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(); }} className={className}>{children}</a>
  ),
}));

import { ASK_SUGGESTIONS, AskMeridian } from "./AskMeridian";

const answer = (over: Partial<AskAnswer> = {}): AskAnswer => ({
  answer: "The weakest objects are Material master at 61.0 and Business partner at 80.5.",
  intent: "weakest_objects",
  data: [{ label: "Material master", value: 61 }, { label: "Business partner", value: 80.5 }],
  chart: "bar",
  links: [
    { label: "Open Material master", href: "/objects/material_master?run=run-1" },
    { label: "Elsewhere", href: "https://example.com" },
  ],
  facts: [
    { statement: "Material master scores 61.0", value: 61, source: "Run of 25 Oct, Material master score", href: "/objects/material_master?run=run-1" },
    { statement: "Business partner scores 80.5", value: 80.5, source: "Run of 25 Oct, Business partner score", href: null },
  ],
  coverage: 1,
  grounded: true,
  phrased: false,
  ai: false,
  version_id: "run-1",
  ...over,
});

function renderAsk() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AskMeridian /></QueryClientProvider>);
}

const launcher = () => screen.getByRole("button", { name: "Ask Meridian" });

async function ask(question: string) {
  renderAsk();
  fireEvent.click(launcher());
  const input = await screen.findByLabelText("Your question");
  fireEvent.change(input, { target: { value: question } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  api.askMeridian.mockReset();
});

describe("AskMeridian", () => {
  it("opens a panel with six suggested questions and focuses the input", async () => {
    renderAsk();
    fireEvent.click(launcher());
    expect(await screen.findByRole("dialog", { name: "Ask Meridian" })).toBeInTheDocument();
    for (const q of ASK_SUGGESTIONS) expect(screen.getByRole("button", { name: q })).toBeInTheDocument();
    expect(ASK_SUGGESTIONS).toHaveLength(6);
    for (const q of ["How many records fail MM045?", "When will the open records be fixed?", "What is the value at risk?", "What will the score be in 30 days?"]) {
      expect(ASK_SUGGESTIONS).toContain(q);
    }
    await waitFor(() => expect(screen.getByLabelText("Your question")).toHaveFocus());
  });

  it("sends with Enter and the current run, then renders the answer, its chart and in-app links only", async () => {
    api.askMeridian.mockResolvedValue(answer());
    renderAsk();
    fireEvent.click(launcher());
    const input = await screen.findByLabelText("Your question");
    fireEvent.change(input, { target: { value: "Which objects are weakest?" } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByText(/The weakest objects are Material master/)).toBeInTheDocument();
    expect(api.askMeridian).toHaveBeenCalledWith({ question: "Which objects are weakest?", version_id: "run-1" });
    expect(screen.getByText("Which objects are weakest?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Material master" })).toHaveAttribute("href", "/objects/material_master?run=run-1");
    expect(screen.queryByRole("link", { name: "Elsewhere" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Answer chart/ })).toBeInTheDocument();
    expect(screen.queryByText(/by the model/)).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("sends a suggested question on click and shows the pending state", async () => {
    let resolve: (a: AskAnswer) => void = () => {};
    api.askMeridian.mockReturnValue(new Promise<AskAnswer>((r) => { resolve = r; }));
    renderAsk();
    fireEvent.click(launcher());
    fireEvent.click(await screen.findByRole("button", { name: ASK_SUGGESTIONS[3] }));
    expect(await screen.findByText("Reading the figures")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    resolve(answer({ answer: "Ana Steward holds 7 open items.", intent: "owners", data: null, chart: null, links: [] }));
    expect(await screen.findByText("Ana Steward holds 7 open items.")).toBeInTheDocument();
    expect(screen.queryByText("Reading the figures")).not.toBeInTheDocument();
  });

  it("labels a model-worded answer in words, above the answer", async () => {
    api.askMeridian.mockResolvedValue(answer({ answer: "Material master is the object to watch, at 61.0.", intent: "weakest_objects", phrased: true, ai: true, data: null, chart: null }));
    await ask("Anything odd?");
    const answerText = await screen.findByText("Material master is the object to watch, at 61.0.");
    const label = screen.getByText("Worded by the model from these figures");
    expect(label.compareDocumentPosition(answerText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Written by the model|AI-generated|aggregated findings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/written by the model/i)).not.toBeInTheDocument();
  });

  it("lists the figures behind an answer in a closed disclosure, with their sources", async () => {
    api.askMeridian.mockResolvedValue(answer());
    await ask("Which objects are weakest?");
    const toggle = await screen.findByRole("button", { name: "Based on 2 figures" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Material master scores 61.0")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Figures behind this answer" });
    expect(toggle).toHaveAttribute("aria-controls", list.id);
    expect(screen.getByText("Material master scores 61.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run of 25 Oct, Material master score" })).toHaveAttribute("href", "/objects/material_master?run=run-1");
    // A figure without a page is named, not linked.
    expect(screen.getByText("Run of 25 Oct, Business partner score").closest("a")).toBeNull();
    expect(screen.queryByText("Covers part of your question")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Material master scores 61.0")).not.toBeInTheDocument();
  });

  it("omits the disclosure when there are no figures", async () => {
    api.askMeridian.mockResolvedValue(answer({ answer: "Ask me about your scores.", intent: "help", facts: [], data: null, chart: null }));
    await ask("Hello");
    await screen.findByText("Ask me about your scores.");
    expect(screen.queryByRole("button", { name: /Based on/ })).not.toBeInTheDocument();
  });

  it("notes partial coverage before the figures", async () => {
    api.askMeridian.mockResolvedValue(answer({
      answer: "Material master scores 61.0.", intent: "retrieval", coverage: 0.5, data: null, chart: null,
      facts: [{ statement: "Material master scores 61.0", value: 61, source: "Rule ranking", href: "/rules?run=run-1" }],
    }));
    await ask("Material master and the weather?");
    const note = await screen.findByText("Covers part of your question");
    const toggle = screen.getByRole("button", { name: "Based on 1 figure" });
    expect(note.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders a refusal as a plain sentence with its suggestions, no chart, no figures and no error tone", async () => {
    api.askMeridian.mockResolvedValue(answer({
      answer: "Your figures do not cover that. Try asking how the score has moved.", intent: "refused", coverage: 0, phrased: false,
      facts: [],
      links: [{ label: "How has the score moved?", href: "/insights?run=run-1" }],
    }));
    await ask("What is the weather?");
    expect(await screen.findByText("Your figures do not cover that. Try asking how the score has moved.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How has the score moved?" })).toHaveAttribute("href", "/insights?run=run-1");
    expect(screen.queryByRole("img", { name: /Answer chart/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Based on/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Covers part of your question")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never shows an answer the server could not check against the figures", async () => {
    api.askMeridian.mockResolvedValue(answer({ answer: "Material master scores 99.", grounded: false }));
    await ask("Which objects are weakest?");
    expect(await screen.findByText("This answer could not be checked against your figures")).toBeInTheDocument();
    expect(screen.queryByText(/scores 99/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Answer chart/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Based on/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Material master" })).toBeInTheDocument();
  });

  it("answers politely when the request fails", async () => {
    api.askMeridian.mockRejectedValue(new Error("network"));
    renderAsk();
    fireEvent.click(launcher());
    const input = await screen.findByLabelText("Your question");
    fireEvent.change(input, { target: { value: "How has the score moved?" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText(/could not reach Meridian/)).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the launcher", async () => {
    renderAsk();
    fireEvent.click(launcher());
    const input = await screen.findByLabelText("Your question");
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask Meridian" })).not.toBeInTheDocument());
    await waitFor(() => expect(launcher()).toHaveFocus());
  });

  it("is hidden in print", () => {
    renderAsk();
    expect(launcher().closest(".m-print-hide")).not.toBeNull();
  });
});
