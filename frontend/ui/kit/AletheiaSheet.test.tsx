import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AletheiaSheet } from "./AletheiaSheet";

const labels = { title: "Aletheia", scope: "Material master", close: "Close", inputLabel: "Ask about this object", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };

describe("AletheiaSheet", () => {
  it("renders nothing when closed", () => {
    render(<AletheiaSheet open={false} onClose={() => {}} labels={labels} thread={[]} suggestions={[]} onAsk={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows thread, evidence and action chips, and asks suggestions", () => {
    const ask = vi.fn();
    render(<AletheiaSheet open onClose={() => {}} labels={labels} onAsk={ask} suggestions={["What fails most?"]}
      thread={[{ id: "1", role: "aletheia", text: "Two rules fail.", evidence: ["MM003 fails 1,200 records"], actions: [{ id: "a", label: "Open the rule", href: "/rules" }] }]} />);
    expect(screen.getByRole("dialog", { name: "Aletheia" })).toBeTruthy();
    expect(screen.getByText("MM003 fails 1,200 records")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the rule" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What fails most?" }));
    expect(ask).toHaveBeenCalledWith("What fails most?");
  });
  it("sends typed text and closes on Escape", () => {
    const ask = vi.fn();
    const close = vi.fn();
    render(<AletheiaSheet open onClose={close} labels={labels} onAsk={ask} suggestions={[]} thread={[]} />);
    fireEvent.change(screen.getByLabelText("Ask about this object"), { target: { value: " why? " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(ask).toHaveBeenCalledWith("why?");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});
