import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { listDefinitions } from "@/lib/api/v2/requests";
import { resetRequestsFixture } from "@/lib/api/v2/fixtures/requests";
import { RequestAnalyticsScreen } from "./RequestAnalyticsScreen";
import { RequestNewScreen } from "./RequestNewScreen";
import { RequestScreen } from "./RequestScreen";
import { RequestsScreen } from "./RequestsScreen";
import { WorkflowsScreen } from "./WorkflowsScreen";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  resetRequestsFixture();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/requests?fixture=1");
});
afterEach(() => undo());

const screens: [string, ReactElement][] = [
  ["Change requests", <RequestsScreen key="a" />],
  ["New request", <RequestNewScreen key="b" />],
  ["Process analytics", <RequestAnalyticsScreen key="c" />],
  ["Workflows", <WorkflowsScreen key="d" />],
  ["New spare part: hydraulic seal kit", <RequestScreen key="e" id="CR-1001" />],
];

describe("change request screens", () => {
  it.each(screens)("%s renders its title in fixture mode", async (title, el) => {
    renderWithQuery(<AletheiaProvider>{el}</AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("lists fixture requests", async () => {
    renderWithQuery(<AletheiaProvider><RequestsScreen /></AletheiaProvider>);
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
  });
});

describe("workflow definitions", () => {
  it("creates a workflow in three steps and adds a version to it", async () => {
    window.history.replaceState(null, "", "/requests/workflows?fixture=1");
    renderWithQuery(<AletheiaProvider><ToastHost><WorkflowsScreen /></ToastHost></AletheiaProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "New workflow" }));
    const dlg = await screen.findByRole("dialog", { name: "New workflow" });
    fireEvent.change(await within(dlg).findByLabelText("Workflow name"), { target: { value: "Vendor release" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Next" }));
    fireEvent.change(await within(dlg).findByLabelText(/^Step name 1/), { target: { value: "Owner check" } });
    fireEvent.change(within(dlg).getByLabelText(/^Approver rule 1/), { target: { value: "manager" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Next" }));
    expect(await within(dlg).findByText(/1\. Owner check/)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Create workflow" }));
    await waitFor(async () => expect((await listDefinitions()).items.some((d) => d.key === "vendor-release" && d.version === 1)).toBe(true));

    fireEvent.click(await screen.findByRole("button", { name: "New version" }));
    const v = await screen.findByRole("dialog", { name: "New version" });
    fireEvent.change(await within(v).findByLabelText(/^SLA hours 1/), { target: { value: "24" } });
    fireEvent.click(within(v).getByRole("button", { name: "Next" }));
    fireEvent.click(await within(v).findByRole("switch", { name: "Make this the active version" }));
    fireEvent.click(within(v).getByRole("button", { name: "Save new version" }));
    fireEvent.click(await screen.findByRole("button", { name: "Activate version" }));
    await waitFor(async () => expect((await listDefinitions()).items.some((d) => d.version === 2 && d.active && d.definition.steps && JSON.stringify(d.definition).includes("\"sla_hours\":24"))).toBe(true));
  });
});
