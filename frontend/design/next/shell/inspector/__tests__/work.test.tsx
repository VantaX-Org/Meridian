import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s9 from "@/lib/api/v2/step9";
import * as runs from "@/lib/api/v2/runs";
import * as batches from "@/lib/api/v2/batches";
import * as work from "@/lib/api/v2/work";
import * as requests from "@/lib/api/v2/requests";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../../kit";
import { WORK_BODIES } from "../work";
import { JobBodyView } from "../work-job";
import { BatchBodyView } from "../work-batch";
import { RequestBodyView } from "../work-request";
import { StepBodyView } from "../work-step";
import { PersonBodyView } from "../work-person";
import { CertificateBodyView } from "../work-cert";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => true }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetWorkFixture();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const show = (node: React.ReactNode, url = "/?fixture=1") => {
  setUrl(url);
  return renderWithQuery(<ToastProvider>{node}</ToastProvider>);
};

describe("work inspector bodies (next)", () => {
  it("registers every work kind", () => {
    expect(Object.keys(WORK_BODIES)).toEqual(["job", "batch", "request", "step", "person", "certificate"]);
  });

  it("certificate: shows the versions and signs with the statement", async () => {
    const sign = vi.spyOn(s9, "signCertificate");
    show(<CertificateBodyView id="w-2" onClose={vi.fn()} />, "/?fixture=1&view=waves");
    const block = await screen.findByTestId("certificate-block");
    expect(block).toHaveTextContent("R. Govender");
    expect(screen.getAllByTestId("certificate-version").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Statement"), { target: { value: "Checked" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign version 1/ }));
    await waitFor(() => expect(sign).toHaveBeenCalledWith("w-2", expect.any(String), "Checked"));
  });

  it("job: shows a failed job's stages and error, and Retry starts it again", async () => {
    const retry = vi.spyOn(runs, "retryJobById");
    show(<JobBodyView id="dl-failed-sf" onClose={vi.fn()} />);
    expect(await screen.findByTestId("job-stages")).toBeInTheDocument();
    expect(screen.getByTestId("job-error")).toHaveTextContent("OData refused credentials");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("dl-failed-sf"));
  });

  it("batch: shows the batch and downloads its sheet", async () => {
    const sheet = vi.spyOn(batches, "downloadBatchSheet").mockReturnValue("B-241.xlsx");
    show(<BatchBodyView id="B-241" onClose={vi.fn()} />);
    expect(await screen.findByTestId("batch-records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download sheet" }));
    await waitFor(() => expect(sheet).toHaveBeenCalled());
  });

  it("person: shows the person and reassigns their open work", async () => {
    const getWork = vi.spyOn(work, "getWork");
    show(<PersonBodyView id="u-tm" onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "T. Mokoena" })).toBeInTheDocument();
    expect(screen.getByText("t.mokoena@example.com")).toBeInTheDocument();
    const reassign = screen.getByRole("button", { name: "Reassign" });
    await waitFor(() => expect(reassign).toBeEnabled());
    fireEvent.click(reassign);
    const menu = await screen.findByRole("menu", { name: "Reassign to" });
    fireEvent.click((await within(menu).findAllByRole("menuitem"))[0]);
    await waitFor(() => expect(getWork).toHaveBeenCalledWith(expect.objectContaining({ assigned: "u-tm", status: "open" })));
  });

  it("step: shows the fields the step writes and closes", async () => {
    const onClose = vi.fn();
    show(<StepBodyView id="material_master:PTP-GR-MIGO" onClose={onClose} />, "/o/ecc-production/material-master/processes?fixture=1");
    expect(await screen.findByTestId("step-fields")).toBeInTheDocument();
    for (const a of screen.queryAllByTestId("step-fix")) expect(a.getAttribute("href")).toContain("/work?rule=");
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("request: shows the request and posts a comment", async () => {
    const comment = vi.spyOn(requests, "commentRequest");
    show(<RequestBodyView id="CR-1001" onClose={vi.fn()} />, "/requests?fixture=1");
    expect(await screen.findByRole("heading", { name: "New spare part: hydraulic seal kit" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "Looks right" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(comment).toHaveBeenCalledWith("CR-1001", "Looks right"));
  });
});
