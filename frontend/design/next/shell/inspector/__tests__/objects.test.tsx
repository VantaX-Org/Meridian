import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { landscapeFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as runsApi from "@/lib/api/v2/runs";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../../kit";
import { OBJECTS_BODIES } from "../objects";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "admin", label: "Admin", name: "", email: null, fixture: true, can: () => true }) };
});
vi.mock("@/lib/api/v2/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/client")>();
  return { ...m, v2Send: vi.fn(m.v2Send) };
});
import { v2Send } from "@/lib/api/v2/client";

const sent = vi.mocked(v2Send);
const [ECC] = landscapeFixture.systems;

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  sent.mockClear();
  vi.restoreAllMocks();
  setUrl(`/?fixture=1&system=${ECC.id}`);
});

const show = (kind: string, id: string) => {
  const Body = OBJECTS_BODIES[kind];
  return renderWithQuery(
    <ToastProvider>
      <Body id={id} onClose={vi.fn()} />
    </ToastProvider>,
  );
};
const call = (method: string, path: string) => sent.mock.calls.find((c) => c[0] === method && c[1] === path);
const noPassword = () => expect(JSON.stringify(sent.mock.calls)).not.toMatch(/password/i);

describe("registry", () => {
  it("holds the eleven object kinds", () => {
    expect(Object.keys(OBJECTS_BODIES).sort()).toEqual(
      ["config", "connection", "feature", "field", "golden", "mapping", "survivorship", "syncschedule", "system", "term", "zobject"],
    );
  });
});

describe("system", () => {
  it("shows the facts and tests the connection", async () => {
    const spy = vi.spyOn(runsApi, "testSystemConnection");
    show("system", ECC.id);
    expect(await screen.findByText("ECC production")).toBeInTheDocument();
    expect(await screen.findByText("RFC connection succeeded (client 100, 41 ms)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(ECC.id));
  });
});

describe("connection", () => {
  it("saves the settings and never sends a password", async () => {
    show("connection", ECC.id);
    const name = await screen.findByLabelText("Name");
    expect(screen.getByTestId("password-note")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.change(name, { target: { value: "ECC prod" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(call("PUT", `/systems/${ECC.id}`)).toBeDefined());
    expect(call("PUT", `/systems/${ECC.id}`)?.[2]).toMatchObject({ name: "ECC prod" });
    noPassword();
  });
});

describe("config", () => {
  it("lists the objects of the area and loads it again", async () => {
    const spy = vi.spyOn(runsApi, "loadSystemConfig");
    show("config", `${ECC.id}:enterprise_structure`);
    expect(await screen.findByText("Enterprise structure")).toBeInTheDocument();
    expect(await screen.findByText("Company codes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load configuration again" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(ECC.id));
  });
});

describe("syncschedule", () => {
  it("changes the timetable", async () => {
    show("syncschedule", `${ECC.id}:p-ecc-1`);
    const form = await screen.findByRole("form", { name: "Change the schedule" });
    expect(screen.getByText("Mondays at 04:00 UTC")).toBeInTheDocument();
    fireEvent.change(within(form).getByRole("combobox", { name: "Schedule" }), { target: { value: "0 2 * * *" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(call("PATCH", `/systems/${ECC.id}/profiles/p-ecc-1`)?.[2]).toMatchObject({ schedule_cron: "0 2 * * *" }));
  });
});

describe("zobject", () => {
  it("shows the profile and saves the registry entry", async () => {
    show("zobject", "z-2");
    const form = await screen.findByRole("form", { name: "Registry entry" });
    expect(screen.getAllByText("ZZPACKVAR").length).toBeGreaterThan(0);
    fireEvent.change(within(form).getByLabelText("Owner"), { target: { value: "S. Dlamini" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(call("PUT", "/z-objects/registry/z-2")?.[2]).toMatchObject({ owner: "S. Dlamini" }));
  });
});

describe("golden", () => {
  it("shows a golden record with its fields and sources", async () => {
    show("golden", "gr-0");
    expect(await screen.findByRole("table", { name: "Golden fields and how each value was chosen" })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Source records" })).toBeInTheDocument();
  });

  it("marks a pair as not a duplicate", async () => {
    show("golden", "pair:ms-0");
    const button = await screen.findByRole("button", { name: "Not a duplicate" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Different sizes" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Not a duplicate" })).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByRole("button", { name: "Not a duplicate" }));
    await waitFor(() => expect(call("POST", "/match-scores/ms-0/decision")?.[2]).toEqual({ decision: "reject", reason: "Different sizes" }));
  });
});

describe("survivorship", () => {
  it("lists the rules and previews them", async () => {
    show("survivorship", "material_master");
    expect(await screen.findByRole("list", { name: "Survivorship rules" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    await waitFor(() => expect(call("POST", "/survivorship-rules/preview")?.[2]).toMatchObject({ domain: "material_master" }));
  });
});

describe("field", () => {
  it("shows the dictionary facts and links each rule that checks it", async () => {
    show("field", "MARA.MEINS");
    expect((await screen.findAllByText("Base Unit of Measure")).length).toBeGreaterThan(0);
    const rules = await screen.findByRole("list", { name: "Rules that check it" });
    const link = within(rules).getAllByRole("link")[0];
    expect(link.getAttribute("href")).toContain("open=rule");
    fireEvent.click(link);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("term", () => {
  it("shows the definition and marks the term as reviewed", async () => {
    show("term", "gt-mtart");
    expect(await screen.findByText(/Groups materials with the same attributes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as reviewed" }));
    await waitFor(() => expect(call("POST", "/glossary/gt-mtart/review")).toBeDefined());
  });
});

describe("feature", () => {
  it("lists the rules that block the feature and links to the fix", async () => {
    show("feature", "Migration cockpit: material load");
    const list = await screen.findByRole("list", { name: "Rules blocking this feature" });
    expect(within(list).getByText("MM142")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fix MM142 in Work/ }).getAttribute("href")).toBeTruthy();
  });
});

describe("mapping", () => {
  it("saves the column of a mapping", async () => {
    show("mapping", "fm-2");
    const input = await screen.findByLabelText("Column header in your file");
    fireEvent.change(input, { target: { value: "MAT_TYPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the mapping" }));
    await waitFor(() => expect(call("PUT", "/field-mappings/fm-2")?.[2]).toMatchObject({ customer_field: "MAT_TYPE" }));
  });
});
