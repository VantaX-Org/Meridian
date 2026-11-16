import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/issues";
import { ToastProvider } from "../../../kit";
import { RecordIssues } from "../Issues";

const Q = vi.hoisted(() => ({ can: (_p: string): boolean => true }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = () => renderWithQuery(<ToastProvider><RecordIssues /></ToastProvider>);
beforeEach(() => { Q.can = () => true; setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Record issues (native)", () => {
  it("renders the fixture issues in the table", async () => {
    wrap();
    expect(await screen.findByTestId("issues-banner")).toBeInTheDocument();
    const table = await screen.findByTestId("issues-table");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  });

  it("moves the selected issues to a new status", async () => {
    const bulk = vi.spyOn(api, "bulkIssues").mockResolvedValue({ updated: 1 } as never);
    wrap();
    const table = await screen.findByTestId("issues-table");
    const boxes = await within(table).findAllByRole("checkbox");
    fireEvent.click(boxes[boxes.length - 1]);
    const form = await screen.findByTestId("issues-bulk");
    fireEvent.change(within(form).getAllByRole("combobox")[0], { target: { value: "in_progress" } });
    fireEvent.click(within(form).getByTestId("issues-apply"));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ status: "in_progress" })));
  });

  it("hides export without the export right and says a 403 cannot be read", async () => {
    Q.can = (p) => p !== "export";
    vi.spyOn(api, "getIssues").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the record issues.")).toBeInTheDocument();
    expect(screen.queryByTestId("issues-export")).toBeNull();
  });
});
