import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { resetDataRequests } from "@/lib/api/v2/fixtures/dataRequests";
import { ToastProvider } from "../../kit";
import { ConfigScreen } from "../Config";
import { DataRequests } from "../DataRequests";
import { Materials } from "../Materials";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

// A material number the role may not read: the route answers 403 for it.
vi.mock("@/lib/api/v2/materials", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/materials")>();
  return { ...m, getMaterial: (k: string) => (k === "DENIED" ? Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 })) : m.getMaterial(k)) };
});

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetDataRequests();
  Q.can = () => true;
  Q.shared = false;
});

describe("Configuration (next)", () => {
  it("shows the banner and findings, and reads the configuration again", async () => {
    wrap(<ConfigScreen />);
    await waitFor(() => expect(screen.getByTestId("config-banner")).toBeTruthy());
    expect(screen.getByTestId("config-findings")).toBeTruthy();
    fireEvent.click(screen.getByTestId("config-rerun"));
    await waitFor(() => expect(screen.getByText(/The configuration is being read again/)).toBeTruthy());
  });

  it("offers no re-read without the analyse permission", async () => {
    Q.can = (a) => a !== "analyse";
    wrap(<ConfigScreen />);
    await waitFor(() => expect(screen.getByTestId("config-rerun-gate")).toBeTruthy());
    expect(screen.queryByTestId("config-rerun")).toBeNull();
  });

  it("offers export on the findings only with the export permission", async () => {
    wrap(<ConfigScreen />);
    const panel = await screen.findByTestId("config-findings");
    await waitFor(() => expect(within(panel).getByTestId("export-csv")).toBeTruthy());
  });

  it("hides export without the export permission", async () => {
    Q.can = (a) => a !== "export";
    wrap(<ConfigScreen />);
    const panel = await screen.findByTestId("config-findings");
    expect(within(panel).queryByTestId("table-export")).toBeNull();
  });
});

describe("Data requests (next)", () => {
  it("lets the owner fill a value and send it for approval", async () => {
    wrap(<DataRequests />);
    fireEvent.click(await screen.findByTestId("dr-open-req-1"));
    fireEvent.change(await screen.findByTestId("dr-input-item-1"), { target: { value: "ROH" } });
    fireEvent.click(screen.getByTestId("dr-submit-req-1"));
    await waitFor(() => expect(screen.getByText("1 value sent for approval")).toBeTruthy());
  });

  it("shows each request's object with the run it stands at, or a reason", async () => {
    wrap(<DataRequests />);
    const row = await screen.findByTestId("dr-mine-req-1");
    await waitFor(() => expect(within(row).queryByTestId("run-chip") ?? within(row).getByTitle(/run/i)).toBeTruthy());
  });

  it("hides the new request form without the assign permission", async () => {
    Q.can = (a) => a !== "assign";
    wrap(<DataRequests />);
    await waitFor(() => expect(screen.getByText("Sending a data request needs the assign permission.")).toBeTruthy());
    expect(screen.queryByTestId("dr-create")).toBeNull();
  });
});

describe("Materials (next)", () => {
  it("opens a material from the address", async () => {
    setUrl("/more?fixture=1&m=000000000010004711");
    wrap(<Materials />);
    const banner = await screen.findByTestId("material-banner");
    expect(within(banner).getByText("Hydraulic pump seal kit")).toBeTruthy();
  });

  it("opens a material from the search, and says when it is not in the master", async () => {
    wrap(<Materials />);
    const form = screen.getByTestId("material-search");
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "10004711" } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByTestId("material-banner")).toBeTruthy());
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "99999" } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText("This material is not in the material master.")).toBeTruthy());
  });

  it("says the role cannot read material records on a 403", async () => {
    setUrl("/more?fixture=1&m=DENIED");
    wrap(<Materials />);
    await waitFor(() => expect(screen.getByText("Your role cannot read material records.")).toBeTruthy());
  });
});
