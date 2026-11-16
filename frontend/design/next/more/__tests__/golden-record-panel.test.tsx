import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/golden-writeback";
import { ToastProvider } from "../../kit";
import { GoldenRecordPanel } from "../GoldenRecordPanel";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = (el: ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/golden");
  Q.can = () => true;
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Golden record panel", () => {
  it("shows the preview and the change history, and approves a request after the confirm", async () => {
    wrap(<GoldenRecordPanel id="gr-0" status="golden" />);
    expect(await screen.findByText("Golden fields")).toBeInTheDocument();
    expect(screen.getByTestId("gw-history")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("gw-approve"));
    expect(await screen.findByText("Approve the write to SAP")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(screen.getByTestId("gw-outcome")).toHaveTextContent("The values are written to SAP next."));
  });

  it("runs the SAP check and reports the outcome", async () => {
    wrap(<GoldenRecordPanel id="gr-1" status="golden" />);
    fireEvent.click(await screen.findByTestId("gw-check"));
    expect(await screen.findByTestId("gw-outcome")).toBeInTheDocument();
  });

  it("asks for promotion first when the record is not golden", async () => {
    wrap(<GoldenRecordPanel id="gr-4" status="pending_review" />);
    expect(await screen.findByText("Promote this record to golden first. Only an approved golden record is sent to SAP.")).toBeInTheDocument();
  });

  it("explains the missing permission", async () => {
    Q.can = () => false;
    wrap(<GoldenRecordPanel id="gr-0" status="golden" />);
    expect(await screen.findByText("Checking or sending to SAP needs the apply permission, which your role does not hold.")).toBeInTheDocument();
  });

  it("shows an error with retry when the history cannot be read", async () => {
    const spy = vi.spyOn(api, "getGoldenHistory").mockRejectedValue(new Error("boom"));
    wrap(<GoldenRecordPanel id="gr-2" status="golden" />);
    expect(await screen.findByText("The change history could not be read.")).toBeInTheDocument();
    spy.mockResolvedValue([]);
    fireEvent.click(screen.getAllByRole("button", { name: /try again|retry/i })[0]);
    expect(await screen.findByText("No change has been recorded for this record yet.")).toBeInTheDocument();
  });
});
