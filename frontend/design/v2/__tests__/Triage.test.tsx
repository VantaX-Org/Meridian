import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as triageApi from "@/lib/api/v2/triage";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { V2Shell } from "../shell/V2Shell";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undoLayout: () => void = () => undefined;

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  resetWorkFixture();
  undoLayout = stubLayout(1400, 700);
  setUrl("/?fixture=1");
});
afterEach(() => {
  undoLayout();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const mount = (search = "") => {
  const url = `/?fixture=1${search}&open=triage`;
  window.history.pushState({}, "", url);
  setUrl(url);
  return renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
};
const panel = async () => {
  const frame = await screen.findByTestId("inspector");
  await within(frame).findByRole("group", { name: "SLA days per severity" });
  return frame;
};

describe("triage and SLA settings", () => {
  it("is an entry in the account menu that opens the panel", async () => {
    setUrl("/?fixture=1");
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    fireEvent.click(await screen.findByRole("button", { name: /^Account/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Triage and SLA" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Triage and SLA" })).toBeInTheDocument();
    expect(getUrl()).toContain("open=triage");
  });

  it("shows the SLA days per severity, what escalation does, and the digest", async () => {
    mount();
    const frame = await panel();
    const group = within(frame).getByRole("group", { name: "SLA days per severity" });
    expect(within(group).getByLabelText("Critical")).toHaveValue("1");
    expect(within(group).getByLabelText("High")).toHaveValue("3");
    expect(within(group).getByLabelText("Medium")).toHaveValue("7");
    expect(within(group).getByLabelText("Low")).toHaveValue("14");
    expect(text(frame)).toContain("A record that passes its SLA is escalated to the team lead, else the fallback owner.");
    expect(within(frame).getByLabelText("Your digest")).toHaveValue("weekly");
    expect(within(frame).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a changed severity with a PUT of its minutes and shows it saved", async () => {
    const put = vi.spyOn(triageApi, "putSlaPolicy");
    mount();
    const frame = await panel();
    fireEvent.change(within(frame).getByLabelText("High"), { target: { value: "2" } });
    expect(within(frame).getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(within(frame).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({ severity: "high", resolve_minutes: 2880 });
    expect(await within(frame).findByTestId("action-result")).toHaveTextContent("Saved");
    await waitFor(() => expect(within(frame).getByLabelText("High")).toHaveValue("2"));
    expect(within(frame).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the digest through the preferences", async () => {
    const patch = vi.spyOn(triageApi, "patchDigest");
    const put = vi.spyOn(triageApi, "putSlaPolicy");
    mount();
    const frame = await panel();
    fireEvent.change(within(frame).getByLabelText("Your digest"), { target: { value: "daily" } });
    fireEvent.click(within(frame).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("daily"));
    expect(put).not.toHaveBeenCalled();
    await waitFor(() => expect(within(frame).getByLabelText("Your digest")).toHaveValue("daily"));
  });

  it("refuses days that are not a number above zero", async () => {
    mount();
    const frame = await panel();
    fireEvent.change(within(frame).getByLabelText("Low"), { target: { value: "0" } });
    expect(within(frame).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(frame).getByText("Days must be a number between 0 and 365.")).toBeInTheDocument();
    expect(within(frame).getByLabelText("Low")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the server's own sentence when a save is refused", async () => {
    vi.spyOn(triageApi, "putSlaPolicy").mockRejectedValueOnce(Object.assign(new Error("x"), { response: { data: { detail: "Your role cannot change SLA policies." } } }));
    mount();
    const frame = await panel();
    fireEvent.change(within(frame).getByLabelText("Critical"), { target: { value: "2" } });
    fireEvent.click(within(frame).getByRole("button", { name: "Save" }));
    expect(await within(frame).findByTestId("action-result")).toHaveTextContent("Your role cannot change SLA policies.");
  });

  it("is a read-only view without the permission: days as words, no inputs, and a sentence that says why", async () => {
    mount("&role=viewer");
    const frame = await screen.findByTestId("inspector");
    const group = await within(frame).findByRole("group", { name: "SLA days per severity" });
    expect(within(group).queryAllByRole("textbox")).toHaveLength(0);
    expect(text(group)).toContain("1 day");
    expect(text(group)).toContain("14 days");
    expect(within(frame).getByText(/Changing SLA days needs the manage triage permission/)).toBeInTheDocument();
    expect(within(frame).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
