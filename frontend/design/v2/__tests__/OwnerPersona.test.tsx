import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { PERSONA_LABEL } from "@/lib/v2/hooks";
import { LandscapeCanvas } from "../screens/Landscape";
import { Inspector } from "../Inspector";
import { ToastProvider } from "../Toast";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;

function visit(search = "") {
  const url = `/?fixture=1${search}`;
  window.history.pushState({}, "", url);
  setUrl(url);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const mount = () =>
  renderWithQuery(
    <ToastProvider>
      <LandscapeCanvas />
      <Inspector />
    </ToastProvider>,
  );

describe("the data owner on the landscape", () => {
  it("has a label of their own", () => {
    expect(PERSONA_LABEL.owner).toBe("Data owner");
  });

  it("gets 'Approve batch B-241' as the next step: the batch with the most at risk that they did not build", async () => {
    visit("&persona=owner");
    mount();
    const next = await screen.findByRole("link", { name: "Approve batch B-241" });
    expect(next).toHaveClass("m2-next");
    expect(next.getAttribute("href")).toContain("open=batch%3AB-241");
    // One button, and none of the other personas' steps.
    expect(screen.queryByRole("link", { name: "Open the no-go objects" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Accept the suggested values" })).toBeNull();
  });

  it("says how many batches wait and how their SLA stands", async () => {
    visit("&persona=owner");
    mount();
    const line = await screen.findByTestId("owner-line");
    expect(text(line)).toBe("2 batches wait for your approval SLA met on 92% of your open work");
  });

  it("the steward and the lead do not get the owner's line or button", async () => {
    visit("&persona=steward");
    mount();
    await screen.findByTestId("landscape-sentence");
    expect(screen.queryByTestId("owner-line")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Approve batch/ })).toBeNull();
  });

  it("the button opens the batch inspector on the landscape", async () => {
    visit("&persona=owner&open=batch%3AB-241");
    mount();
    const insp = await screen.findByTestId("inspector");
    expect(await within(insp).findByRole("heading", { level: 2, name: "Batch B-241" })).toBeInTheDocument();
  });
});
