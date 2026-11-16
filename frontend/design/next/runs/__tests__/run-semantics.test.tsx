import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { RunSemantics } from "../RunSemantics";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: false, viewAs: null, shared: false }) }));

const S = vi.hoisted(() => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(async () => ({
    profiled: true,
    source: "upload",
    origin: "file",
    rows_sampled: 200,
    columns: [{ column: "EMAIL", detected: "email", confidence: 0.9, type: "email", confirmed: false, filled: 0.8, conformance: 0.95 }],
    types: ["email", "phone"],
    trust: { score: 82.5, parts: { dqs: 80, conformance: 95, freshness: null, completeness: 80 }, weights: { dqs: 0.4, conformance: 0.2, freshness: 0.2, completeness: 0.2 } },
    suggested_rules: [],
  })),
}));
vi.mock("@/lib/api/v2/step9", async (orig) => ({ ...(await orig<object>()), getSemanticTypes: S.get, putSemanticType: S.put }));

beforeEach(() => {
  setUrl("/next/run/r1");
  window.sessionStorage.removeItem("mn_v2_fixture");
  S.put.mockClear();
});

describe("Run column types (next)", () => {
  it("shows the trust score and confirms a column type", async () => {
    renderWithQuery(<ToastProvider><RunSemantics id="r1" /></ToastProvider>);
    await waitFor(() => expect(screen.getByTestId("trust-score").textContent).toBe("82.5"));
    fireEvent.change(screen.getByLabelText("Type of EMAIL"), { target: { value: "phone" } });
    await waitFor(() => expect(S.put).toHaveBeenCalledWith("r1", "EMAIL", "phone"));
    await waitFor(() => expect(screen.getByText(/Type of EMAIL saved/)).toBeTruthy());
  });
});
