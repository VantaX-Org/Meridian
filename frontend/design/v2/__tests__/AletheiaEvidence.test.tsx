import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaEvidence } from "../screens/AletheiaEvidence";
import { VerifiedMark, RuleRibbon } from "../screens/rules-parts";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => { window.sessionStorage.setItem("mn_v2_fixture", "1"); setUrl("/aletheia/evidence"); });
afterEach(() => window.sessionStorage.clear());

describe("evidence ledger shell", () => {
  it("shows the empty state with a next step", () => {
    renderWithQuery(<AletheiaEvidence />);
    expect(screen.getByText("Aletheia evidence will appear here after the next checked run")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open verified survivorship" }).getAttribute("href")).toContain("/aletheia-survivorship");
  });
});

describe("rules parts", () => {
  it("draws the verified mark with its word", () => {
    renderWithQuery(<VerifiedMark />);
    expect(screen.getByTestId("verified-mark")).toHaveTextContent("Verified");
  });
  it("gives a dash with a reason when the rule has no runs in the system", () => {
    renderWithQuery(<RuleRibbon values={[null, null]} />);
    expect(screen.getByTitle(/no runs of this rule/i)).toHaveTextContent("\u2014");
  });
  it("draws failing records across runs and says the range, skipping runs the rule missed", () => {
    renderWithQuery(<RuleRibbon values={[40, null, 12]} />);
    expect(screen.getByRole("img", { name: "Failing records over the last 2 runs: 40 to 12" })).toBeInTheDocument();
  });
});
