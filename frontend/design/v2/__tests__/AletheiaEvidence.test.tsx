import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaEvidence } from "../screens/AletheiaEvidence";
import { VerifiedMark, RibbonDash } from "../screens/rules-parts";
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
  it("gives a dash with a reason for findings across runs", () => {
    renderWithQuery(<RibbonDash />);
    expect(screen.getByTitle(/not available yet/i)).toHaveTextContent("\u2014");
  });
});
