import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ReasonPanel } from "../ReasonPanel";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/runs/v1?fixture=1");
});

describe("ReasonPanel", () => {
  it("shows Aletheia's drivers and anomalies with the evidence behind each", async () => {
    renderWithQuery(<ReasonPanel versionId="v1" />);
    expect(await screen.findByText("Why, according to Aletheia")).toBeTruthy();
    expect((await screen.findAllByTestId("reason-risk")).length + screen.queryAllByTestId("reason-anomaly").length).toBeGreaterThan(0);
    expect(screen.getByTestId("reason-risk-evidence")).toBeTruthy();
    expect(screen.getByTestId("reason-anomaly-evidence")).toBeTruthy();
  });
});
