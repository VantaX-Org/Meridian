import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { push, setUrl } from "@/design/v2/__tests__/nav-store";
import { WorkSwap } from "../WorkSwap";

const nf = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }));
vi.mock("next/navigation", async () => ({ ...(await import("@/design/v2/__tests__/nav-store")).navigationMock, notFound: nf }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
const prefs = vi.hoisted(() => ({ value: { ui_next: true } as Record<string, unknown> }));
vi.mock("@/hooks/use-preferences", () => ({ usePreferences: () => ({ prefs: prefs.value, setPref: () => undefined, loading: false }) }));

vi.mock("@/design/v2/screens/Attention", () => ({ Attention: () => <div data-testid="mounted">Attention</div> }));
vi.mock("@/design/v2/screens/Cleansing", () => ({ Cleansing: () => <div data-testid="mounted">Cleansing</div> }));
vi.mock("@/design/v2/screens/Exceptions", () => ({ Exceptions: () => <div data-testid="mounted">Exceptions</div> }));
vi.mock("@/design/v2/screens/FixDrafts", () => ({ FixDrafts: () => <div data-testid="mounted">FixDrafts</div> }));
vi.mock("@/design/v2/screens/ProcessAnalytics", () => ({ ProcessAnalytics: () => <div data-testid="mounted">ProcessAnalytics</div> }));
vi.mock("@/design/v2/screens/Triage", () => ({ Triage: () => <div data-testid="mounted">Triage</div> }));
vi.mock("@/design/v2/screens/WorkAnalytics", () => ({ WorkAnalytics: () => <div data-testid="mounted">WorkAnalytics</div> }));
vi.mock("@/design/v2/screens/WorkMonitor", () => ({ WorkMonitor: () => <div data-testid="mounted">WorkMonitor</div> }));
vi.mock("@/design/v2/screens/DataRequests", () => ({ DataRequests: () => <div data-testid="mounted">DataRequests</div> }));
vi.mock("@/design/v2/screens/Requests", () => ({ RequestsCanvas: () => <div data-testid="mounted">RequestsCanvas</div> }));
vi.mock("@/design/v2/screens/RequestForm", () => ({ RequestFormCanvas: () => <div data-testid="mounted">RequestFormCanvas</div> }));

beforeEach(() => {
  prefs.value = { ui_next: true };
  nf.mockClear();
  push.mockClear();
  setUrl("/work");
});

describe("every /work/<segment> address", () => {
  it.each([
    [["triage"], "Triage", "triage"],
    [["exceptions"], "Exceptions", "exceptions"],
    [["analytics"], "WorkAnalytics", "analytics"],
    [["drafts"], "FixDrafts", "drafts"],
    [["requests", "new"], "RequestFormCanvas", "requests"],
    [["requests", "analytics"], "ProcessAnalytics", "requests"],
    [["data-requests"], "DataRequests", "requests"],
  ])("with the new interface, %j mounts %s under the %s tab", (slug, name, tab) => {
    renderWithQuery(<WorkSwap slug={slug} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent(name);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", `nx-work-panel-${tab}`);
  });

  it("the tabs move within /work, not the preview path", () => {
    renderWithQuery(<WorkSwap slug={["triage"]} />);
    screen.getByRole("tab", { name: "Exceptions" }).click();
    expect(push).toHaveBeenCalledWith("/work/exceptions");
  });

  it.each([
    ["triage", "Triage"],
    ["monitor", "WorkMonitor"],
    ["exceptions", "Exceptions"],
    ["analytics", "WorkAnalytics"],
  ])("with the earlier interface, /work/%s keeps its page", (slug, name) => {
    prefs.value = {};
    renderWithQuery(<WorkSwap slug={[slug]} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent(name);
  });

  it("with the earlier interface, a new-only address is not found", () => {
    prefs.value = {};
    expect(() => renderWithQuery(<WorkSwap slug={["drafts"]} />)).toThrow("NEXT_NOT_FOUND");
    expect(nf).toHaveBeenCalled();
  });
});
