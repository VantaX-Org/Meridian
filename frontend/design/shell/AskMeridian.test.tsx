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
  ai: false,
  version_id: "run-1",
  ...over,
});

function renderAsk() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AskMeridian /></QueryClientProvider>);
}

const launcher = () => screen.getByRole("button", { name: "Ask Meridian" });

beforeEach(() => {
  api.askMeridian.mockReset();
});

describe("AskMeridian", () => {
  it("opens a panel with four suggested questions and focuses the input", async () => {
    renderAsk();
    fireEvent.click(launcher());
    expect(await screen.findByRole("dialog", { name: "Ask Meridian" })).toBeInTheDocument();
    for (const q of ASK_SUGGESTIONS) expect(screen.getByRole("button", { name: q })).toBeInTheDocument();
    expect(ASK_SUGGESTIONS).toHaveLength(4);
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
    expect(screen.queryByText(/AI-generated/)).not.toBeInTheDocument();
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

  it("marks an AI-generated answer", async () => {
    api.askMeridian.mockResolvedValue(answer({ answer: "Material master is the object to watch.", intent: "ai", ai: true, data: null, chart: null }));
    renderAsk();
    fireEvent.click(launcher());
    const input = await screen.findByLabelText("Your question");
    fireEvent.change(input, { target: { value: "Anything odd?" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Material master is the object to watch.")).toBeInTheDocument();
    expect(screen.getByText(/AI-generated/)).toBeInTheDocument();
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
