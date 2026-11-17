import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AletheiaPanel from "./AletheiaPanel";
import type { AskScope, AskStreamHandlers } from "@/lib/api/v2/assistant";

const sent: AskScope[] = [];
vi.mock("./aletheia/stream", async (orig) => ({
  ...(await orig<typeof import("./aletheia/stream")>()),
  streamAnswer: async (body: AskScope, h: AskStreamHandlers) => {
    sent.push(body);
    const ev = { intent: "x", version_id: "v1", facts: [{ statement: "R1 fails 40 records", value: 40, source: "findings", checks: [{ check_id: "R1" }] }], citations: [], data: null, chart: null, links: [], coverage: 1, grounded: true };
    h.onEvidence(ev);
    h.onToken("Streamed ");
    h.onDone({ ...ev, answer: "Streamed answer", ai: true, phrased: true });
  },
}));
import { AletheiaProvider, useAletheia, useAletheiaScope } from "./aletheia";

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };

function Screen({ name }: { name: string }) {
  useAletheiaScope({ key: name, label: `Asking about ${name}`, suggestions: ["What fails most?"], answer: (p) => ({ text: `${name}: ${p}`, evidence: ["12 records"] }) });
  return null;
}
function Opener() {
  const { setOpen } = useAletheia();
  return <button type="button" onClick={() => setOpen(true)}>open</button>;
}

describe("AletheiaPanel", () => {
  it("is closed until opened, then shows the screen scope and its suggestions", () => {
    render(<AletheiaProvider><Screen name="Material master" /><Opener /><AletheiaPanel labels={labels} /></AletheiaProvider>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByRole("dialog", { name: "Aletheia" })).toBeTruthy();
    expect(screen.getByText("Asking about Material master")).toBeTruthy();
    expect(screen.getByRole("button", { name: "What fails most?" })).toBeTruthy();
  });

  it("answers through the scope adapter into one thread", async () => {
    render(<AletheiaProvider initialOpen><Screen name="Material master" /><AletheiaPanel labels={labels} /></AletheiaProvider>);
    fireEvent.click(screen.getByRole("button", { name: "What fails most?" }));
    expect(await screen.findByText("Material master: What fails most?", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("12 records")).toBeTruthy();
  });

  it("streams a typed question the screen cannot answer locally, scoped to its ids", async () => {
    function Hybrid() {
      useAletheiaScope({ key: "mm", label: "Asking about Material master", suggestions: ["Local?"], context: { module: "material_master", version_id: "v1" }, answer: (p) => (p === "Local?" ? { text: "local answer" } : null) });
      return null;
    }
    render(<AletheiaProvider initialOpen><Hybrid /><AletheiaPanel labels={labels} /></AletheiaProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask a question" }), { target: { value: "Why do plants differ?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Streamed answer", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Evidence" }).textContent).toContain("R1");
    expect(sent.at(-1)).toEqual({ question: "Why do plants differ?", scope: "current", module: "material_master", version_id: "v1" });
    fireEvent.click(screen.getByRole("button", { name: "Local?" }));
    expect(await screen.findByText("local answer", { selector: "p" })).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it("falls back to the default scope line when no screen is registered", () => {
    render(<AletheiaProvider initialOpen><AletheiaPanel labels={labels} /></AletheiaProvider>);
    expect(screen.getByText("All objects")).toBeTruthy();
  });
});
