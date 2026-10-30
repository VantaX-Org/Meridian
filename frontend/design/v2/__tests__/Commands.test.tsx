import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as landscapeApi from "@/lib/api/v2/landscape";
import { ledgerRegistry, type LedgerTarget } from "@/lib/v2/keys";
import { V2Shell } from "../shell/V2Shell";
import { push, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.history.pushState({}, "", "/?fixture=1");
  push.mockClear();
  setUrl("/?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  ledgerRegistry.set(null);
  vi.restoreAllMocks();
});

async function ask(query: string) {
  renderWithQuery(
    <V2Shell>
      <h1>Page</h1>
    </V2Shell>,
  );
  fireEvent.keyDown(document.body, { key: "k", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search or type a command" });
  const input = within(dialog).getByRole("combobox");
  fireEvent.change(input, { target: { value: query } });
  return { dialog, input };
}

const stubLedger = (): LedgerTarget => {
  const t: LedgerTarget = { accept: vi.fn(), notAnIssue: vi.fn(), acceptRisk: vi.fn(), exportSheet: vi.fn(), focusChips: vi.fn(), step: vi.fn(() => false) };
  ledgerRegistry.set(t);
  return t;
};

describe("the command line's actions", () => {
  it("approve opens the ledger on the approvals filter", async () => {
    const { dialog, input } = await ask("approve");
    await within(dialog).findByText("Approvals waiting 612");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/work?filter=approvals"));
  });

  it("export from another screen opens the ledger with ?export=1, which exports what the ledger shows", async () => {
    const { dialog, input } = await ask("export");
    await within(dialog).findByText("Export fix sheet");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/work?export=1"));
  });

  it("export on the ledger exports the rows on screen without leaving it", async () => {
    const ledger = stubLedger();
    const { dialog, input } = await ask("export");
    await within(dialog).findByText("Export fix sheet");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ledger.exportSheet).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("the API's own action ids are wired whatever address it sends", async () => {
    vi.spyOn(landscapeApi, "getCommand").mockResolvedValue({
      groups: [
        {
          kind: "action",
          label: "Actions",
          items: [
            { id: "approvals", title: "Approvals waiting 3", href: "/inbox?kind=approvals" },
            { id: "export-fix-sheet", title: "Export fix sheet", href: "/fix?action=export" },
          ],
        },
      ],
    });
    const { dialog, input } = await ask("ap");
    await within(dialog).findByText("Approvals waiting 3");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/work?filter=approvals"));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/inbox"));
  });

  it("a record result opens the record in the inspector", async () => {
    const { dialog, input } = await ask("101");
    await within(dialog).findByText(/Material 000000000000000101/);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(decodeURIComponent(push.mock.calls[0][0] as string)).toContain("open=record:material_master:MATNR=000000000000000101");
  });
});
