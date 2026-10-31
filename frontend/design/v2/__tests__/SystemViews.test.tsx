import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { landscapeFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as runsApi from "@/lib/api/v2/runs";
import { Inspector } from "../Inspector";
import { SystemCanvas } from "../screens/System";
import { ConnectCanvas } from "../screens/system/ConnectCanvas";
import { getUrl, replace, setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: new Set<string>() }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "", email: null, fixture: true, can: (a: string) => h.allowed.has(a) }) };
});
vi.mock("@/lib/api/v2/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/client")>();
  return { ...m, v2Send: vi.fn(m.v2Send) };
});
import { v2Send } from "@/lib/api/v2/client";

const sent = vi.mocked(v2Send);
const [ECC] = landscapeFixture.systems;
const ALL = ["manage_systems", "trigger_sync", "analyse", "ai_feedback", "manage_rules"];

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  sent.mockClear();
  replace.mockClear();
  h.allowed = new Set(ALL);
});

const canvas = (tab: string) => {
  setUrl(`/s/${ECC.id}?fixture=1&tab=${tab}`);
  return renderWithQuery(<SystemCanvas id={ECC.id} />);
};
const open = (item: string) => {
  setUrl(`/?fixture=1&open=${item}`);
  return renderWithQuery(<Inspector />);
};
const bodyOf = (method: string, path: string) => sent.mock.calls.find((c) => c[0] === method && c[1] === path)?.[2] as Record<string, unknown> | undefined;

describe("Schedules", () => {
  it("adds a schedule for an object that has none", async () => {
    canvas("schedules");
    const form = await screen.findByRole("form", { name: "Add a schedule" });
    const object = within(form).getByRole("combobox", { name: "Object" }) as HTMLSelectElement;
    await waitFor(() => expect(object.options.length).toBeGreaterThan(1));
    const domain = object.options[1].value;
    expect(within(form).getByRole("button", { name: "Add schedule" })).toBeDisabled();
    fireEvent.change(object, { target: { value: domain } });
    fireEvent.change(within(form).getByRole("combobox", { name: "Schedule" }), { target: { value: "0 2 * * *" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add schedule" }));
    expect(await screen.findByText("Schedule added")).toBeInTheDocument();
    expect(bodyOf("POST", `/systems/${ECC.id}/profiles`)).toMatchObject({ domain, schedule_cron: "0 2 * * *", extraction_mode: "full", active: true });
    await waitFor(() => expect(within(screen.getByTestId("system-schedules")).getAllByRole("row")).toHaveLength(4));
  });

  it("a custom cron is checked before it can be sent", async () => {
    canvas("schedules");
    const form = await screen.findByRole("form", { name: "Add a schedule" });
    const object = within(form).getByRole("combobox", { name: "Object" }) as HTMLSelectElement;
    await waitFor(() => expect(object.options.length).toBeGreaterThan(1));
    fireEvent.change(object, { target: { value: object.options[1].value } });
    fireEvent.change(within(form).getByRole("combobox", { name: "Schedule" }), { target: { value: "custom" } });
    fireEvent.change(within(form).getByLabelText("Cron expression"), { target: { value: "99 2 * * *" } });
    expect(within(form).getByRole("alert")).toHaveTextContent("Minute is out of range");
    expect(within(form).getByRole("button", { name: "Add schedule" })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Cron expression"), { target: { value: "30 3 * * 1" } });
    expect(within(form).getByRole("button", { name: "Add schedule" })).toBeEnabled();
  });

  it("pauses and resumes a schedule", async () => {
    canvas("schedules");
    fireEvent.click(await screen.findByRole("button", { name: "Pause the Material master schedule" }));
    expect(await screen.findByText("Schedule paused")).toBeInTheDocument();
    expect(bodyOf("PATCH", `/systems/${ECC.id}/profiles/p-ecc-1`)).toEqual({ active: false });
    expect(await screen.findByRole("button", { name: "Resume the Material master schedule" })).toBeInTheDocument();
  });

  it("deletes a schedule after asking", async () => {
    canvas("schedules");
    fireEvent.click(await screen.findByRole("button", { name: "Delete the Business partner schedule" }));
    expect(sent.mock.calls.some((c) => c[0] === "DELETE")).toBe(false);
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete schedule" }));
    expect(await screen.findByText("Schedule deleted")).toBeInTheDocument();
    expect(sent).toHaveBeenCalledWith("DELETE", `/systems/${ECC.id}/profiles/p-ecc-2`);
    await waitFor(() => expect(within(screen.getByTestId("system-schedules")).getAllByRole("row")).toHaveLength(2));
  });

  it("a viewer reads the schedules and cannot change them", async () => {
    h.allowed = new Set(["view"]);
    canvas("schedules");
    await screen.findByTestId("system-schedules");
    expect(screen.queryByRole("form", { name: "Add a schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pause/ })).toBeNull();
    expect(screen.getByTestId("gate-note")).toHaveTextContent("manage systems permission");
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("the schedule inspector", () => {
  it("changes the timetable and the mode", async () => {
    open(`syncschedule:${ECC.id}:p-ecc-1`);
    const form = await screen.findByRole("form", { name: "Change the schedule" });
    const save = within(form).getByRole("button", { name: "Save schedule" });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByRole("combobox", { name: "Schedule" }), { target: { value: "0 2 * * *" } });
    fireEvent.change(within(form).getByRole("combobox", { name: "Mode" }), { target: { value: "full" } });
    fireEvent.click(save);
    expect(await screen.findByText("Schedule saved")).toBeInTheDocument();
    expect(bodyOf("PATCH", `/systems/${ECC.id}/profiles/p-ecc-1`)).toEqual({ schedule_cron: "0 2 * * *", extraction_mode: "full" });
  });

  it("deletes the schedule and closes", async () => {
    open(`syncschedule:${ECC.id}:p-ecc-2`);
    fireEvent.click(await screen.findByRole("button", { name: "Delete schedule" }));
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete schedule" }));
    await waitFor(() => expect(sent).toHaveBeenCalledWith("DELETE", `/systems/${ECC.id}/profiles/p-ecc-2`));
    await waitFor(() => expect(getUrl()).not.toContain("open="));
  });

  it("without the permission it only reads", async () => {
    h.allowed = new Set(["view"]);
    open(`syncschedule:${ECC.id}:p-ecc-1`);
    expect(await screen.findByText("Mondays at 04:00 UTC")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Change the schedule" })).toBeNull();
    expect(screen.getByTestId("gate-note")).toBeInTheDocument();
  });
});

describe("Configuration", () => {
  it("an area inspector shows the objects behind it, where each came from, and its rows", async () => {
    open(`config:${ECC.id}:enterprise_structure`);
    const dialog = await screen.findByRole("dialog", { name: "Enterprise structure" });
    const table = await within(dialog).findByTestId("area-objects");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getAllByText("Live from the system")).toHaveLength(3);
    fireEvent.click(within(table).getByRole("button", { name: /T001 Company codes/ }));
    const rows = await within(dialog).findByTestId("config-items");
    expect(within(rows).getByText("Meridian Holdings")).toBeInTheDocument();
  });

  it("a failed object says why and falls back to the baseline", async () => {
    open(`config:${ECC.id}:human_resources`);
    const table = await screen.findByTestId("area-objects");
    expect(within(table).getAllByText("SAP standard baseline").length).toBeGreaterThan(0);
    expect(table).toHaveTextContent("No authorisation to read this table");
  });

  it("the source view says how much was read live", async () => {
    canvas("configuration&part=source");
    await waitFor(() => expect(screen.getByTestId("config-source-summary")).toHaveTextContent("25 of 28 configuration objects were read live"));
    const sources = await screen.findByTestId("spro-sources");
    expect(within(sources).getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("the drift log and the comparison with the target are views of the page", async () => {
    canvas("configuration&part=drift");
    const drift = await screen.findByTestId("config-drift");
    expect(within(drift).getAllByRole("row")).toHaveLength(4);
  });

  it("proposes the matches to the steward queue", async () => {
    canvas("configuration&part=compare");
    expect(await screen.findByTestId("compare-target")).toHaveTextContent("Compared with S/4HANA sandbox");
    fireEvent.click(screen.getByRole("button", { name: "Propose matches" }));
    expect(await screen.findByText("2 matches sent to the steward queue")).toBeInTheDocument();
    expect(sent).toHaveBeenCalledWith("POST", `/config-pairing/propose/${ECC.id}`);
  });

  it("proposing needs the analyse permission", async () => {
    h.allowed = new Set(["view"]);
    canvas("configuration&part=compare");
    expect(await screen.findByRole("button", { name: "Propose matches" })).toBeDisabled();
  });
});

describe("Custom objects", () => {
  it("marks an anomaly as expected", async () => {
    canvas("custom-objects&part=anomalies");
    fireEvent.click(await screen.findByRole("button", { name: "Mark ZZPACKVAR null_rate_spike as expected" }));
    expect(await screen.findByText("Marked as expected")).toBeInTheDocument();
    expect(bodyOf("POST", "/z-objects/anomalies/za-1/feedback")).toEqual({ status: "dismissed" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark ZZPACKVAR null_rate_spike as expected" })).toBeNull());
  });

  it("the anomaly decision needs the AI feedback permission", async () => {
    h.allowed = new Set(["view"]);
    canvas("custom-objects&part=anomalies");
    await screen.findByTestId("z-anomalies");
    expect(screen.queryByRole("button", { name: /as expected/ })).toBeNull();
    expect(screen.getAllByTestId("gate-note").length).toBeGreaterThan(0);
  });

  it("creates a Z rule, validating the name and the condition first", async () => {
    canvas("custom-objects&part=rules");
    const form = await screen.findByRole("form", { name: "New Z rule" });
    fireEvent.click(within(form).getByRole("button", { name: "Create Z rule" }));
    expect(within(form).getAllByRole("alert").map((a) => a.textContent)).toEqual(["Enter a rule name", "Enter the condition"]);
    expect(sent).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Rule name"), { target: { value: "Pack variant set" } });
    fireEvent.change(within(form).getByLabelText("Condition"), { target: { value: "ZZPACKVAR is not blank" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create Z rule" }));
    expect(await screen.findByText("Z rule created")).toBeInTheDocument();
    expect(bodyOf("POST", "/z-objects/rules")).toMatchObject({ rule_name: "Pack variant set", custom_condition: "ZZPACKVAR is not blank", severity: "medium" });
    await waitFor(() => expect(within(screen.getByTestId("z-rules")).getByText("Pack variant set")).toBeInTheDocument());
  });

  it("the object inspector edits the registry entry", async () => {
    open("zobject:z-2");
    const form = await screen.findByRole("form", { name: "Registry entry" });
    fireEvent.change(within(form).getByLabelText("Owner"), { target: { value: "S. Dlamini" } });
    fireEvent.change(within(form).getByLabelText("Status"), { target: { value: "under_review" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("ZZPACKVAR saved")).toBeInTheDocument();
    expect(bodyOf("PUT", "/z-objects/registry/z-2")).toMatchObject({ owner: "S. Dlamini", status: "under_review" });
  });

  it("the object inspector shows its profile and anomalies, and a viewer cannot edit", async () => {
    h.allowed = new Set(["view"]);
    open("zobject:z-2");
    expect(await screen.findByTestId("z-profile")).toHaveTextContent("31.0%");
    expect(await screen.findByRole("list", { name: "Anomalies of this object" })).toHaveTextContent("Null rate spike");
    expect(screen.getByLabelText("Owner")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});

describe("the connection form", () => {
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("walks the setup steps: skip SuccessFactors, rail marks the current step, invite finishes", async () => {
    setUrl("/s/new?fixture=1");
    renderWithQuery(<ConnectCanvas />);
    const form = await screen.findByRole("form", { name: "Connect a system" });
    expect(screen.getByRole("button", { name: /Connect SAP/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Choose objects/ })).toBeDisabled();
    fill("Name", "ECC test");
    fill("Host", "ecc-test.internal");
    fill("Client", "300");
    fill("Instance number", "01");
    fill("Password", "s3cret");
    fireEvent.click(within(form).getByRole("button", { name: "Connect system" }));
    await screen.findByRole("heading", { name: "Connect SuccessFactors" });
    expect(screen.getByRole("button", { name: /Connect SuccessFactors/ })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("heading", { name: "Choose objects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Choose policy packs/ }));
    expect(screen.queryByRole("heading", { name: "Choose policy packs" })).toBeNull();
    fireEvent.click((await screen.findAllByRole("checkbox"))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Choose policy packs" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save schedule" }));
    await screen.findByRole("heading", { name: "Invite people" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "Setup complete" })).toBeInTheDocument();
    expect(bodyOf("POST", "/users/invite")).toMatchObject({ email: "a@b.co" });
  });

  it("connects a new system, validating first, and opens it", async () => {
    setUrl("/s/new?fixture=1");
    renderWithQuery(<ConnectCanvas />);
    const form = await screen.findByRole("form", { name: "Connect a system" });
    fireEvent.click(within(form).getByRole("button", { name: "Connect system" }));
    expect(await within(form).findByText("Enter a system name")).toBeInTheDocument();
    expect(within(form).getByText("Enter the host name")).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
    fill("Name", "ECC test");
    fill("Host", "ecc-test.internal");
    fill("Client", "300");
    fill("Instance number", "01");
    fill("Password", "s3cret");
    fireEvent.click(within(form).getByRole("button", { name: "Connect system" }));
    expect(await screen.findByRole("heading", { name: "Connect SuccessFactors" })).toBeInTheDocument();
    expect(bodyOf("POST", "/systems")).toMatchObject({ name: "ECC test", system_type: "ecc", host: "ecc-test.internal", client: "300", sysnr: "01", auth_type: "rfc", credentials: { password: "s3cret" } });
  });

  it("tests a draft before it is saved", async () => {
    setUrl("/s/new?fixture=1");
    renderWithQuery(<ConnectCanvas />);
    fill("Name", "ECC test");
    fill("Host", "ecc-test.internal");
    fill("Client", "300");
    fill("Instance number", "01");
    fill("Password", "s3cret");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByTestId("test-outcome")).toHaveTextContent("Connected");
    expect(sent).toHaveBeenCalledWith("POST", "/systems/test-connection", expect.objectContaining({ host: "ecc-test.internal" }));
    fill("Host", "ecc-other.internal");
    expect(screen.queryByTestId("test-outcome")).toBeNull();
    expect(screen.getByText(/A connection field changed after the last test/)).toBeInTheDocument();
  });

  it("edits the settings without sending a secret that was not typed", async () => {
    open(`connection:${ECC.id}`);
    await screen.findByRole("form", { name: "Connection settings of ECC production" });
    fill("Name", "ECC prod");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("ECC prod is saved.")).toBeInTheDocument();
    const body = bodyOf("PUT", `/systems/${ECC.id}`);
    expect(body).toMatchObject({ name: "ECC prod", host: "ecc-prd.example.internal", client: "100" });
    expect(body).not.toHaveProperty("credentials");
  });

  it("chooses the extraction path and the table reader of an ABAP system", async () => {
    open(`connection:${ECC.id}`);
    await screen.findByRole("form", { name: "Connection settings of ECC production" });
    const path = screen.getByLabelText("Extraction path") as HTMLSelectElement;
    expect(path.value).toBe("table_reader");
    expect(Array.from(path.options).map((o) => o.value)).toEqual(["table_reader", "odp", "auto"]); // OData is S/4 only
    fill("Extraction path", "odp");
    fill("Table reader", "/BODS/RFC_READ_TABLE2");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("ECC production is saved.")).toBeInTheDocument();
    expect(bodyOf("PUT", `/systems/${ECC.id}`)).toMatchObject({ extraction_path: "odp", read_function: "/BODS/RFC_READ_TABLE2" });
  });

  it("the OData path of an S/4HANA on premise system needs the Gateway base URL", async () => {
    const S4 = landscapeFixture.systems[1];
    open(`connection:${S4.id}`);
    await screen.findByRole("form", { name: `Connection settings of ${S4.name}` });
    expect((screen.getByLabelText("Extraction path") as HTMLSelectElement).value).toBe("auto");
    expect((screen.getByLabelText("Table reader") as HTMLSelectElement).value).toBe("auto");
    fill("Extraction path", "odata");
    expect(screen.queryByLabelText("Table reader")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter the Gateway base URL")).toBeInTheDocument();
    expect(bodyOf("PUT", `/systems/${S4.id}`)).toBeUndefined();
    fill("Gateway base URL", "https://s4gw.example.internal:44300");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(bodyOf("PUT", `/systems/${S4.id}`)).toMatchObject({ extraction_path: "odata", base_url: "https://s4gw.example.internal:44300" }));
  });

  it("rotates only the credentials", async () => {
    open(`connection:${ECC.id}`);
    await screen.findByRole("form", { name: "Connection settings of ECC production" });
    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
    expect(await screen.findByText(/Type the new secret first/)).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
    fill("Password", "n3w");
    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
    expect(await screen.findByText(/Credentials replaced/)).toBeInTheDocument();
    expect(bodyOf("PUT", `/systems/${ECC.id}`)).toEqual({ credentials: { password: "n3w" } });
  });

  it("removes the system only after its name is typed", async () => {
    open(`connection:${ECC.id}`);
    await screen.findByRole("form", { name: "Connection settings of ECC production" });
    fireEvent.click(screen.getByRole("button", { name: "Remove system" }));
    const bar = screen.getByTestId("confirm-bar");
    expect(within(bar).getByRole("button", { name: "Remove system" })).toBeDisabled();
    fill("Type ECC production to confirm", "ECC production");
    fireEvent.click(within(bar).getByRole("button", { name: "Remove system" }));
    await waitFor(() => expect(sent).toHaveBeenCalledWith("DELETE", `/systems/${ECC.id}`));
  });

  it("without manage systems the form only reads", async () => {
    h.allowed = new Set(["view"]);
    open(`connection:${ECC.id}`);
    await screen.findByRole("form", { name: "Connection settings of ECC production" });
    expect(screen.getByTestId("gate-note")).toHaveTextContent("manage systems");
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove system" })).toBeNull();
  });
});

describe("the extraction scope", () => {
  it("is set inline and sent with the extraction", async () => {
    const spy = vi.spyOn(runsApi, "extractObjects");
    open(`system:${ECC.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Extract" }));
    const list = await screen.findByRole("list", { name: "Objects to extract" });
    expect(screen.queryByTestId("scope-editor")).toBeNull();
    fireEvent.click(within(list).getByRole("checkbox", { name: /Material master/ }));
    const scope = await screen.findByTestId("scope-editor");
    expect(screen.getByTestId("scope-sentence")).toHaveTextContent("Scope: everything, no organisational filter.");
    fireEvent.change(within(scope).getByLabelText("Plants"), { target: { value: "1000, 1100" } });
    expect(screen.getByTestId("scope-sentence")).toHaveTextContent("Scope: plants 1000, 1100.");
    fireEvent.click(screen.getByRole("button", { name: "Extract 1 object" }));
    expect(await screen.findByText("Extraction started")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(ECC.id, ["material_master"], true, { plants: ["1000", "1100"] }, undefined);
  });

  it("the date window opens for transactional objects and checks its order", async () => {
    open(`system:${ECC.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Extract" }));
    const list = await screen.findByRole("list", { name: "Objects to extract" });
    const row = Array.from(list.querySelectorAll("label")).find((l) => /SD sales orders/.test(l.textContent ?? ""));
    expect(row).toBeTruthy();
    fireEvent.click(within(row as HTMLElement).getByRole("checkbox"));
    fireEvent.change(await screen.findByLabelText("Documents from"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Documents to"), { target: { value: "2026-01-01" } });
    expect(await screen.findByText("The end date is before the start date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extract 1 object" })).toBeDisabled();
  });

  it("a system with no connection leads to the connection settings", async () => {
    open(`system:${landscapeFixture.systems[2].id}`);
    expect(await screen.findByRole("link", { name: "Connection settings" })).toHaveAttribute("href", expect.stringContaining("open=connection%3A"));
  });
});
