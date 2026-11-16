import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { useObjectRun, type ObjectRun } from "../useObjectRun";
import { renderTab } from "../tabs";
import { RulesTab } from "../tabs/RulesTab";
import { RecordsTab } from "../tabs/RecordsTab";
import { FixesTab } from "../tabs/FixesTab";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

function Harness({ Tab }: { Tab: (p: { o: ObjectRun }) => React.ReactElement }) {
  const o = useObjectRun("ecc-production", "material-master");
  return <Tab o={o} />;
}
const wrap = (Tab: (p: { o: ObjectRun }) => React.ReactElement) =>
  renderWithQuery(
    <ToastProvider>
      <SheetHost>
        <Harness Tab={Tab} />
      </SheetHost>
    </ToastProvider>,
  );
const Overview = ({ o }: { o: ObjectRun }) => <>{renderTab("overview", o, () => {})}</>;

beforeEach(() => {
  setUrl("/o/ecc-production/material-master?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
});

describe("object tabs, fork F (native)", () => {
  it.each([
    ["rules-tab", RulesTab],
    ["records-tab", RecordsTab],
    ["fixes-tab", FixesTab],
    ["overview-trend", Overview],
  ] as const)("renders %s from fixtures", async (id, Tab) => {
    wrap(Tab);
    await waitFor(() => expect(screen.getByTestId(id)).toBeTruthy(), { timeout: 4000 });
  });

  it("opens the simulation from the rules", async () => {
    wrap(RulesTab);
    fireEvent.click(await screen.findByTestId("simulate-rules"));
    await waitFor(() => expect(screen.getByTestId("simulate-dialog")).toBeTruthy());
  });

  it("previews accepting a rule's suggested values", async () => {
    wrap(RulesTab);
    const buttons = await screen.findAllByRole("button", { name: /^Accept all .* suggested values/ }, { timeout: 4000 });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByTestId("accept-preview")).toBeTruthy());
  });

  it("hides Drafts and Accept all without the permissions", async () => {
    Q.can = (a) => a !== "manage_rules" && a !== "apply";
    wrap(RulesTab);
    await screen.findByTestId("rules-tab");
    await waitFor(() => expect(screen.queryByTestId("rules-loading")).toBeNull(), { timeout: 4000 });
    expect(screen.queryByText(/^Drafts/)).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Accept all/ })).toHaveLength(0);
  });

  it("keeps CSV export on the records", async () => {
    wrap(RecordsTab);
    await screen.findByTestId("records-tab");
    await waitFor(() => expect(screen.getAllByTestId("export-csv").length).toBeGreaterThan(0));
  });
});
