import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AletheiaPanel from "./AletheiaPanel";

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };

describe("AletheiaPanel", () => {
  it("renders the shell chat sheet only when open", () => {
    const { rerender } = render(<AletheiaPanel open={false} onClose={() => {}} labels={labels} suggestions={[]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<AletheiaPanel open onClose={() => {}} labels={labels} suggestions={["What fails most?"]} />);
    expect(screen.getByRole("dialog", { name: "Aletheia" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "What fails most?" })).toBeTruthy();
  });
});
