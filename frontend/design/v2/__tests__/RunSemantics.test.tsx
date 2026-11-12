import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetStep9Fixture } from "@/lib/api/v2/fixtures/step9";
import runsJson from "@/lib/api/v2/fixtures/runs.json";
import { RunSemantics } from "../screens/RunSemantics";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
let canUpload = true;
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Analyst", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => a !== "upload" || canUpload }) };
});

const RUN = (runsJson as unknown as { versions: { id: string }[] }).versions[0].id;

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetStep9Fixture();
  canUpload = true;
  setUrl(`/run/${RUN}?fixture=1`);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Run, column types and trust", () => {
  it("shows each column's detected type and confidence and the trust score from four weighted parts", async () => {
    renderWithQuery(<RunSemantics id={RUN} />);
    const trust = await screen.findByRole("table", { name: "Trust score" });
    expect(within(trust).getAllByRole("row")).toHaveLength(6);
    expect(within(trust).getByText("40%")).toBeInTheDocument();
    expect(Number(screen.getByTestId("trust-score").textContent)).toBeGreaterThan(80);
    const cols = screen.getByRole("table", { name: "Column types" });
    const row = within(cols).getByRole("row", { name: /bank_iban/ });
    expect(row).toHaveTextContent("IBAN");
    expect(row).toHaveTextContent("95.0%");
    expect(within(cols).getByRole("row", { name: /row_ref/ })).toHaveTextContent("No type");
  });

  it("suggests rules only from confirmed types, and a confirmed type adds its rules", async () => {
    renderWithQuery(<RunSemantics id={RUN} />);
    const rules = await screen.findByRole("table", { name: "Suggested rules" });
    expect(within(rules).getAllByRole("row").slice(1).every((r) => r.textContent?.includes("contact_email"))).toBe(true);
    fireEvent.change(screen.getByLabelText("Type of bank_iban"), { target: { value: "iban" } });
    await waitFor(() => expect(screen.getByRole("table", { name: "Suggested rules" })).toHaveTextContent("ISO 13616"));
    expect(screen.getByRole("link", { name: "Open rules to add them" }).getAttribute("href")).toContain("/rules");
  });

  it("locks the type select without the upload permission", async () => {
    canUpload = false;
    renderWithQuery(<RunSemantics id={RUN} />);
    expect(await screen.findByLabelText("Type of phone")).toBeDisabled();
    expect(screen.getByText("Confirming a type needs the upload permission.")).toBeInTheDocument();
  });

  it("renders nothing for a run that was not profiled", async () => {
    const { container } = renderWithQuery(<RunSemantics id="not-a-run" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("[data-testid=run-semantics]")).toBeNull();
  });
});
