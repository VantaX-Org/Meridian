import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AskBodyNative, type AskAnswer } from "../AskBodyNative";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const S = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api/v2/object", async (orig) => ({ ...(await orig<object>()), v2Post: S.post }));

const answer: AskAnswer = {
  answer: "Completeness of the material master holds the score at 81.",
  intent: "score_drivers",
  data: [{ label: "Completeness", value: 81 }],
  chart: "bar",
  links: [{ label: "Open the material master", href: "/o/ecc/material_master" }],
  phrased: true,
  version_id: "v-1",
  facts: [{ statement: "Completeness is 81", value: 81, source: "run v-1", checks: [{ check_id: "MM-001" }] }],
  coverage: 0.9,
  grounded: true,
  citations: [{ check_id: "MM-001", module: "material_master", href: "/r/MM-001" }],
};

beforeEach(() => S.post.mockReset());

describe("AskBodyNative", () => {
  it("asks a suggestion, renders the grounded answer and records feedback", async () => {
    S.post.mockImplementation(async (path: string) => (path === "/assistant/ask" ? answer : {}));
    renderWithQuery(<AskBodyNative />);
    fireEvent.click(screen.getByRole("button", { name: "What is holding the score down?" }));
    await waitFor(() => expect(S.post).toHaveBeenCalledWith("/assistant/ask", { question: "What is holding the score down?", scope: "current" }));
    const a = await screen.findByTestId("ask-answer");
    expect(a).toHaveTextContent(answer.answer);
    expect(a).toHaveTextContent("Completeness is 81");
    expect(a).toHaveTextContent("MM-001");
    fireEvent.click(screen.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(S.post).toHaveBeenCalledWith("/insights/feedback", { surface: "aletheia", run_id: "v-1", vote: "up" }));
  });

  it("an ungrounded answer is shown as a refusal", async () => {
    S.post.mockResolvedValue({ ...answer, grounded: false });
    renderWithQuery(<AskBodyNative hero={false} />);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const a = await screen.findByTestId("ask-answer");
    expect(a).toHaveAttribute("data-refused", "1");
    expect(a).not.toHaveTextContent(answer.answer);
  });

  it("a failed question shows the error and retries it", async () => {
    S.post.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(answer);
    renderWithQuery(<AskBodyNative />);
    fireEvent.click(screen.getByRole("button", { name: "What is the money at risk?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("ask-answer")).toBeInTheDocument();
    expect(S.post).toHaveBeenLastCalledWith("/assistant/ask", { question: "What is the money at risk?", scope: "current" });
  });
});
