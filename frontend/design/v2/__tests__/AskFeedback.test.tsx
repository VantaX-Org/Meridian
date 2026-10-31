import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AskBody } from "../inspector/ask";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Aletheia answer feedback", () => {
  it("records one vote per answer and then thanks the user", async () => {
    renderWithQuery(<AskBody hero={false} />);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What is holding the score down?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const answer = await screen.findByTestId("ask-answer");
    const group = within(answer).getByRole("group", { name: "Was this answer helpful?" });
    fireEvent.click(within(group).getByRole("button", { name: "Helpful" }));
    expect(await within(answer).findByText("Thanks, your feedback is recorded.")).toBeInTheDocument();
    expect(within(answer).queryByRole("button", { name: "Not helpful" })).toBeNull();
  });
});
