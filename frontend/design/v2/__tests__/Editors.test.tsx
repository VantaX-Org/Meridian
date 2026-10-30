import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { Inspector } from "../Inspector";
import { ProcessDesigner } from "../screens/ProcessDesigner";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: new Set<string>() }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "steward", label: "Data steward", name: "", email: null, fixture: true, can: (a: string) => h.allowed.has(a) }) };
});
vi.mock("@/lib/api/v2/client", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/client")>();
  return { ...m, v2Send: vi.fn(m.v2Send) };
});
import { v2Send } from "@/lib/api/v2/client";

const sent = vi.mocked(v2Send);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  sent.mockClear();
});

const bodyOf = (method: string, path: string) => sent.mock.calls.find((c) => c[0] === method && c[1] === path)?.[2] as Record<string, unknown> | undefined;

describe("the survivorship editor", () => {
  beforeEach(() => {
    h.allowed = new Set(["mdm.write"]);
    setUrl("/o/ecc-production/material-master/golden?fixture=1&open=survivorship:material_master");
  });
  const render = async () => {
    renderWithQuery(<Inspector />);
    return screen.findByRole("list", { name: "Survivorship rules" });
  };
  const item = (list: HTMLElement, name: string) => within(list).getByRole("listitem", { name });
  const rulesSent = () => (bodyOf("PUT", "/survivorship-rules") as { rules: { field: string; rule_type: string; trusted_sources: string[] | null; weight: number }[] }).rules;

  it("lists the rules of the object by field", async () => {
    const list = await render();
    expect(list.children).toHaveLength(5);
    expect(within(item(list, "MARA-MEINS")).getByLabelText("Rule type")).toHaveValue("trusted_source");
  });

  it("changes a rule and saves the whole set", async () => {
    const list = await render();
    fireEvent.change(within(item(list, "MARA-BRGEW")).getByLabelText("Weight"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(await screen.findByText("Survivorship rules saved")).toBeInTheDocument();
    const rules = rulesSent();
    expect(rules).toHaveLength(5);
    expect(rules.find((r) => r.field === "MARA-BRGEW")).toMatchObject({ weight: 80, rule_type: "most_recent" });
  });

  it("adds a rule, validating the field and the systems first", async () => {
    const list = await render();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const added = within(list).getByRole("listitem", { name: "New rule" });
    fireEvent.change(within(added).getByLabelText("Rule type"), { target: { value: "trusted_source" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(await within(added).findByText("Enter the field")).toBeInTheDocument();
    expect(within(added).getByText("Choose at least one system")).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
    fireEvent.change(within(added).getByLabelText("Field"), { target: { value: "MARA-SPART" } });
    await waitFor(() => expect(within(added).getByLabelText("Add a system").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(within(added).getByLabelText("Add a system"), { target: { value: "ECC production" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(await screen.findByText("Survivorship rules saved")).toBeInTheDocument();
    expect(rulesSent().find((r) => r.field === "MARA-SPART")).toMatchObject({ rule_type: "trusted_source", trusted_sources: ["ECC production"], weight: 50 });
  });

  it("a second rule for the same field is refused before it is sent", async () => {
    const list = await render();
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    const added = within(list).getByRole("listitem", { name: "New rule" });
    fireEvent.change(within(added).getByLabelText("Field"), { target: { value: "MARA-MEINS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(await screen.findAllByText("Another rule already covers this field")).not.toHaveLength(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it("reorders the systems of a rule: the order is the priority", async () => {
    const list = await render();
    const rule = item(list, "MARA-MEINS");
    await waitFor(() => expect(within(rule).getByLabelText("Add a system").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(within(rule).getByLabelText("Add a system"), { target: { value: "S/4HANA sandbox" } });
    fireEvent.click(within(rule).getByRole("button", { name: "Move ECC production down" }));
    expect(within(within(rule).getByRole("list", { name: "Systems for MARA-MEINS" })).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["1S/4HANA sandboxUpDownRemove", "2ECC productionUpDownRemove"]);
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await screen.findByText("Survivorship rules saved");
    expect(rulesSent().find((r) => r.field === "MARA-MEINS")?.trusted_sources).toEqual(["S/4HANA sandbox", "ECC production"]);
  });

  it("deletes a rule after asking, and the save leaves it out", async () => {
    const list = await render();
    fireEvent.click(within(item(list, "MARA-MATKL")).getByRole("button", { name: "Delete the rule for MARA-MATKL" }));
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete rule" }));
    expect(within(list).queryByRole("listitem", { name: "MARA-MATKL" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await screen.findByText("Survivorship rules saved");
    expect(rulesSent().map((r) => r.field)).not.toContain("MARA-MATKL");
    expect(rulesSent()).toHaveLength(4);
  });

  it("without the MDM write permission it only reads", async () => {
    h.allowed = new Set(["view"]);
    const list = await render();
    expect(within(item(list, "MARA-BRGEW")).getByLabelText("Weight")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a rule" })).toBeNull();
    expect(screen.getByTestId("gate-note")).toHaveTextContent("MDM write");
  });
});

describe("the process designer", () => {
  beforeEach(() => {
    h.allowed = new Set(["analyse"]);
    setUrl("/o/ecc-production/material-master/processes/design?fixture=1");
  });
  const render = async () => {
    renderWithQuery(<ProcessDesigner system="ecc-production" module="material-master" />);
    return screen.findByRole("button", { name: "Procure to pay" });
  };
  const detail = () => within(screen.getByTestId("designer-detail"));
  const savedDoc = () => (bodyOf("PUT", "/process-designer/models/pm-1") as { document: { l1: { name: string; l2: { name: string; l3: { l4: { name: string; activities: { name: string; fields: { field: string }[] }[] }[] }[] }[] }[] }; note: string }).document;

  it("shows the model as a tree", async () => {
    await render();
    expect(screen.getByRole("button", { name: /^Sourcing/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Post goods receipt/ })).toBeInTheDocument();
    expect(screen.getByText(/Draft, version 1/)).toBeInTheDocument();
  });

  it("renames a step and saves a new version", async () => {
    const first = await render();
    void first;
    fireEvent.click(screen.getByRole("button", { name: /^Post goods receipt/ }));
    expect(screen.getByRole("button", { name: "Save as a new version" })).toBeDisabled();
    fireEvent.change(detail().getByLabelText("Name"), { target: { value: "Post the goods receipt" } });
    fireEvent.change(screen.getByLabelText("What changed"), { target: { value: "Clearer step name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    expect(await screen.findByText("Saved as version 2")).toBeInTheDocument();
    const body = bodyOf("PUT", "/process-designer/models/pm-1") as { note: string; base_version: number };
    expect(body).toMatchObject({ note: "Clearer step name", base_version: 1 });
    expect(savedDoc().l1[0].l2[1].l3[0].l4[0].name).toBe("Post the goods receipt");
    expect(await screen.findByText(/Draft, version 2/)).toBeInTheDocument();
  });

  it("adds an area under a process", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: "Procure to pay" }));
    const form = screen.getByRole("form", { name: "Add area" });
    fireEvent.click(within(form).getByRole("button", { name: "Add area" }));
    expect(await within(form).findByText("Enter a name")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("New area"), { target: { value: "Invoice verification" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add area" }));
    expect(await screen.findByRole("button", { name: /^Invoice verification/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await screen.findByText("Saved as version 2");
    expect(savedDoc().l1[0].l2.map((a) => a.name)).toEqual(["Sourcing", "Goods receipt", "Invoice verification"]);
  });

  it("reorders areas", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: "Move Goods receipt up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await screen.findByText("Saved as version 2");
    expect(savedDoc().l1[0].l2.map((a) => a.name)).toEqual(["Goods receipt", "Sourcing"]);
  });

  it("deletes an item and everything under it, after asking", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: "Delete Sourcing" }));
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete area" }));
    expect(screen.queryByRole("button", { name: /^Sourcing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Create purchase order/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await screen.findByText("Saved as version 2");
    expect(savedDoc().l1[0].l2.map((a) => a.name)).toEqual(["Goods receipt"]);
  });

  it("maps a field to an activity, checking the form of the field", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: /^Post goods receipt/ }));
    const form = screen.getByRole("form", { name: "Map a field to Check the material" });
    fireEvent.change(within(form).getByLabelText("Map a field"), { target: { value: "brgew" } });
    fireEvent.click(within(form).getByRole("button", { name: "Map field" }));
    expect(await within(form).findByText("Use TABLE.FIELD, for example MARA.MATNR")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Map a field"), { target: { value: "mara.brgew" } });
    fireEvent.click(within(form).getByRole("button", { name: "Map field" }));
    const fields = await screen.findByRole("list", { name: "Fields of Check the material" });
    expect(within(fields).getByText("MARA-BRGEW")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await screen.findByText("Saved as version 2");
    expect(savedDoc().l1[0].l2[1].l3[0].l4[0].activities[0].fields.map((f) => f.field)).toEqual(["MARA.MEINS", "MARA.MTART", "MARA.BRGEW"]);
  });

  it("unmaps a field and deletes an activity", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: /^Post goods receipt/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Unmap MARA.MTART" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Check the material" }));
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await screen.findByText("Saved as version 2");
    expect(savedDoc().l1[0].l2[1].l3[0].l4[0].activities).toEqual([]);
  });

  it("shows what the API refuses to save", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: /^Sourcing/ }));
    fireEvent.change(detail().getByLabelText("Name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    expect(await screen.findByText("The model was not saved")).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: "Problems in the model" })).toHaveTextContent("A name is required");
  });

  it("publishes the model and takes it back to draft", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: "Publish model" }));
    expect(await screen.findByText("Model published")).toBeInTheDocument();
    expect(bodyOf("PATCH", "/process-designer/models/pm-1")).toEqual({ status: "published" });
    expect(await screen.findByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    expect(await screen.findByText(/Published, version 1/)).toBeInTheDocument();
  });

  it("creates a model from the reference, and renames and deletes a model", async () => {
    await render();
    const form = screen.getByRole("form", { name: "Create a model" });
    fireEvent.click(within(form).getByRole("button", { name: "Create model" }));
    expect(await within(form).findByText("Enter a name")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Plant 2 model" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create model" }));
    expect(await screen.findByText("Plant 2 model created")).toBeInTheDocument();
    expect(bodyOf("POST", "/process-designer/models")).toEqual({ name: "Plant 2 model", from: "reference" });
    fireEvent.click(screen.getByRole("button", { name: "Rename model" }));
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "Plant two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Model renamed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete model" }));
    fireEvent.click(within(screen.getByTestId("confirm-bar")).getByRole("button", { name: "Delete model" }));
    expect(await screen.findByText("Model deleted")).toBeInTheDocument();
    expect(sent.mock.calls.some((c) => c[0] === "DELETE" && String(c[1]).startsWith("/process-designer/models/pm-"))).toBe(true);
  });

  it("without the permission the tree is read-only", async () => {
    h.allowed = new Set(["view"]);
    await render();
    expect(screen.getByTestId("gate-note")).toHaveTextContent("analyse or run process discovery");
    expect(screen.queryByRole("button", { name: /^Move/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish model" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Create a model" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Post goods receipt/ }));
    expect(detail().getByLabelText("Name")).toBeDisabled();
  });
});
