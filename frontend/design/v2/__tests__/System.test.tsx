import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { Inspector } from "../Inspector";
import { describeCron, SystemCanvas } from "../screens/System";
import { protocolOf } from "../inspector/system";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: new Set<string>(["trigger_sync", "analyse"]) }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "", email: null, fixture: true, can: (a: string) => h.allowed.has(a) }) };
});

const [ECC, S4, SF] = landscapeFixture.systems;

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
  h.allowed = new Set(["trigger_sync", "analyse"]);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const open = (id: string) => {
  setUrl(`/v2?fixture=1&open=system:${id}`);
  return renderWithQuery(<Inspector />);
};

describe("system words", () => {
  it("names the wire a system speaks, and a cron in words", () => {
    expect(protocolOf("ecc")).toBe("RFC");
    expect(protocolOf("s4hana_cloud")).toBe("OData");
    expect(protocolOf("concur")).toBe("REST");
    expect(describeCron("0 4 * * 1")).toBe("Mondays at 04:00 UTC");
    expect(describeCron("30 2 * * *")).toBe("Every day at 02:30 UTC");
    expect(describeCron("*/5 * * * *")).toBe("*/5 * * * *");
    expect(describeCron(null)).toBe("No schedule");
  });
});

describe("the system inspector", () => {
  it("shows health, type and version, client, last extraction, records and the RFC state", async () => {
    open(ECC.id);
    const dialog = await screen.findByRole("dialog", { name: "ECC production" });
    await waitFor(() => expect(within(dialog).getByText("RFC connection succeeded (client 100, 41 ms)")).toBeInTheDocument());
    const facts = Array.from(dialog.querySelectorAll(".m2-fact")).map((f) => norm(f as HTMLElement));
    expect(facts).toContain("HealthConnected");
    expect(facts).toContain("TypeECC");
    expect(facts).toContain("VersionECC 6.0 EHP8");
    expect(facts).toContain("Client100");
    expect(facts).toContain("Last extraction16 Oct 2026, 04:41");
    expect(facts).toContain("Records400,662");
    await waitFor(() => expect(Array.from(dialog.querySelectorAll(".m2-fact")).map((f) => norm(f as HTMLElement))).toContain("Configuration11 of 12 areas, 12 Oct 2026, 06:03"));
    expect(norm(dialog.querySelector(".m2-ih-sl") as HTMLElement)).toBe("ECC 6.0 EHP8, client 100");
  });

  it("a cloud system says OData, and says why its health is not good", async () => {
    open(SF.id);
    const dialog = await screen.findByRole("dialog", { name: "SuccessFactors" });
    await waitFor(() => expect(within(dialog).getByText("OData refused credentials (HTTP 401)")).toBeInTheDocument());
    expect(Array.from(dialog.querySelectorAll(".m2-fact")).map((f) => norm(f as HTMLElement))).toContain("HealthSign-in refused");
    expect(within(dialog).getByText("OData")).toBeInTheDocument();
  });

  it("Test connection shows the system's own answer in the frame, not a toast", async () => {
    open(ECC.id);
    const test = await screen.findByRole("button", { name: "Test connection" });
    fireEvent.click(test);
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveAttribute("data-tone", "ok");
    expect(result).toHaveTextContent("RFC connection works");
    expect(result).toHaveTextContent("RFC connection to ECC production succeeded (client 100, 41 ms).");
    expect(result.closest('[role="dialog"]')).not.toBeNull(); // inside the inspector
  });

  it("a refused connection is shown as a failure, with the reason", async () => {
    open(SF.id);
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveAttribute("data-tone", "fail");
    expect(result).toHaveTextContent("OData connection failed");
    expect(result).toHaveTextContent("OData refused credentials (HTTP 401). Check the client id and secret in the system settings.");
  });

  it("Load configuration starts the load and links the job", async () => {
    open(ECC.id);
    fireEvent.click(await screen.findByRole("button", { name: "Load configuration" }));
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveTextContent("Configuration load started");
    expect(within(result).getByRole("link", { name: "Open the job" })).toHaveAttribute("href", expect.stringContaining("open=job%3Acl-new-"));
  });

  it("Extract opens the object picker inline; choosing objects starts the extraction", async () => {
    open(ECC.id);
    const extract = await screen.findByRole("button", { name: "Extract" });
    expect(extract).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(extract);
    const picker = await screen.findByTestId("extract-picker");
    const list = await within(picker).findByRole("list", { name: "Objects to extract" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(15);
    const go = within(picker).getByRole("button", { name: "Choose objects to extract" });
    expect(go).toBeDisabled();
    fireEvent.click(within(list).getByRole("checkbox", { name: /Material master/ }));
    fireEvent.click(within(list).getByRole("checkbox", { name: /Business partner/ }));
    const run = within(picker).getByRole("button", { name: "Extract 2 objects" });
    expect(within(picker).getByRole("checkbox", { name: "Analyse straight after extracting" })).toBeChecked();
    fireEvent.click(run);
    const result = await within(picker).findByTestId("action-result");
    expect(result).toHaveTextContent("Extraction started");
    expect(result).toHaveTextContent("2 objects from ECC production, analysed straight after.");
    expect(within(result).getByRole("link", { name: "Open the job" })).toBeInTheDocument();
  });

  it("an extracted system offers Run analysis as the next step", async () => {
    open(S4.id);
    const next = await screen.findByRole("button", { name: "Run analysis on S/4HANA sandbox" });
    expect(next).toHaveClass("m2-next");
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Analysis started");
  });

  it("Schedule goes to the Schedules view of the system", async () => {
    open(ECC.id);
    expect(await screen.findByRole("link", { name: "Schedule" })).toHaveAttribute("href", expect.stringContaining("tab=schedules"));
  });

  it("without the permission the actions are disabled and the inspector says what is needed", async () => {
    h.allowed = new Set(["view"]);
    open(ECC.id);
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load configuration" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Extract" })).toBeDisabled();
    expect(screen.getByText(/need the trigger sync permission/)).toBeInTheDocument();
  });

  it("a system that is not in the tenant is explained", async () => {
    open("missing");
    expect(await screen.findByText(/This system is not in the tenant/)).toBeInTheDocument();
  });
});

describe("the system canvas", () => {
  const canvas = (tab = "") => {
    setUrl(`/v2/s/${ECC.id}?fixture=1${tab}`);
    return renderWithQuery(<SystemCanvas id={ECC.id} />);
  };

  it("is titled by the system, reads its health and last extraction, and has the five views", async () => {
    canvas();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ECC production"));
    const line = await screen.findByTestId("system-status-line");
    expect(norm(line)).toContain("Connected");
    expect(norm(line)).toContain("Last extraction 16 Oct 2026, 04:41");
    expect(norm(line)).toContain("400,662 records");
    const tabs = screen.getByRole("navigation", { name: "Views of ECC production" });
    expect(within(tabs).getAllByRole("link").map((l) => norm(l))).toEqual(["Overview", "Extractions", "Configuration", "Schedules", "Custom objects"]);
    expect(within(tabs).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Schedules" })).toHaveAttribute("href", expect.stringContaining("tab=schedules"));
  });

  it("Overview lists what the latest run scored on this system and its recent jobs", async () => {
    canvas();
    const table = await screen.findByTestId("system-objects");
    expect(within(table).getAllByRole("row")).toHaveLength(16);
    expect(await screen.findByText("Extraction, 15 objects")).toBeInTheDocument();
  });

  it("Extractions lists the system's stored extractions with the run each one made", async () => {
    canvas("&tab=extractions");
    const table = await screen.findByTestId("system-extractions");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    expect(within(rows[0]).getByRole("link", { name: "Open the run" })).toHaveAttribute("href", expect.stringContaining("/v2/run/d3229ded"));
    expect(norm(rows[2])).toContain("Baseline");
  });

  it("Schedules lists the profiles with their cron in words, and hands over to the current interface to edit", async () => {
    canvas("&tab=schedules");
    const table = await screen.findByTestId("system-schedules");
    expect(norm(within(table).getAllByRole("row")[1])).toContain("Mondays at 04:00 UTC");
    expect(screen.getByRole("link", { name: "Edit schedules in the current interface" })).toHaveAttribute("href", `/systems/${ECC.id}?tab=health`);
  });

  it("Configuration reads the latest load and says the area views are still in the current interface", async () => {
    canvas("&tab=configuration");
    expect(await screen.findByText("11 of 12")).toBeInTheDocument();
    const frame = screen.getByTestId("handoff");
    expect(frame).toHaveTextContent("still in the current interface");
    expect(within(frame).getByRole("link")).toHaveAttribute("href", `/systems/${ECC.id}?tab=config`);
  });

  it("Custom objects is a designed frame with the way into the current interface", async () => {
    canvas("&tab=custom-objects");
    const frame = await screen.findByTestId("handoff");
    expect(within(frame).getByRole("link", { name: "Open custom objects in the current interface" })).toHaveAttribute("href", `/systems/${ECC.id}?tab=custom`);
  });

  it("a system that is not in the tenant is explained inside the canvas", async () => {
    setUrl("/v2/s/missing?fixture=1");
    renderWithQuery(<SystemCanvas id="missing" />);
    expect(await screen.findByText(/This system is not in the tenant/)).toBeInTheDocument();
  });
});
