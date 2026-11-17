import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AletheiaPanel from "./AletheiaPanel";
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

  it("falls back to the default scope line when no screen is registered", () => {
    render(<AletheiaProvider initialOpen><AletheiaPanel labels={labels} /></AletheiaProvider>);
    expect(screen.getByText("All objects")).toBeTruthy();
  });
});
