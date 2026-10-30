import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { formatOpen, parseOpen, useOpenItem } from "@/lib/v2/hooks";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { Inspector, InspectorFrame } from "../Inspector";
import { ToastProvider } from "../Toast";
import { getUrl, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const ECC = landscapeFixture.systems[0];
const SF = landscapeFixture.systems[2];

function Harness() {
  const { openItem, open } = useOpenItem();
  return (
    <div>
      <button onClick={() => openItem({ kind: "system", id: ECC.id })}>Open ECC</button>
      <button onClick={() => openItem({ kind: "rule", id: "MM014" })}>Open rule</button>
      <button onClick={() => openItem({ kind: "record", id: "material_master:MATNR=000000000000000101" })}>Open record</button>
      <button>Last control</button>
      <output data-testid="open">{open ? `${open.kind}:${open.id}` : "none"}</output>
      <main id="m2-canvas" tabIndex={-1} />
      <Inspector />
    </div>
  );
}

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/");
});
afterEach(() => window.sessionStorage.clear());

describe("?open round trip", () => {
  it("parses kind and id, keeping colons, equals signs and bars in the id", () => {
    expect(parseOpen("rule:MM014")).toEqual({ kind: "rule", id: "MM014" });
    expect(parseOpen("record:material_master:MATNR=0001|WERKS=3000")).toEqual({ kind: "record", id: "material_master:MATNR=0001|WERKS=3000" });
    expect(parseOpen("system:abc")).toEqual({ kind: "system", id: "abc" });
    expect(parseOpen("nonsense:1")).toBeNull();
    expect(parseOpen("rule:")).toBeNull();
    expect(parseOpen("rule")).toBeNull();
    expect(parseOpen(null)).toBeNull();
  });

  it("formats what it parses", () => {
    const item = { kind: "record" as const, id: "material_master:MATNR=0001|WERKS=3000" };
    expect(parseOpen(formatOpen(item))).toEqual(item);
  });

  it("opening writes ?open= into the URL, keeps the other query, and closing removes it", async () => {
    setUrl("/o/ecc-production/material-master?run=r1&fixture=1");
    renderWithQuery(<Harness />);
    fireEvent.click(screen.getByText("Open rule"));
    expect(getUrl()).toContain("open=rule%3AMM014");
    expect(getUrl()).toContain("run=r1");
    expect(getUrl()).toContain("fixture=1");
    expect(screen.getByTestId("open")).toHaveTextContent("rule:MM014");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(getUrl()).not.toContain("open=");
    expect(getUrl()).toContain("run=r1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens straight from a URL, as a shared link does", async () => {
    setUrl(`/?open=system:${ECC.id}`);
    renderWithQuery(<Harness />);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAccessibleName(ECC.name));
  });
});

describe("<Inspector>", () => {
  it("is a dialog named by its title, with the same anatomy for a system: status line, facts, actions", async () => {
    setUrl(`/?open=system:${ECC.id}`);
    renderWithQuery(<Harness />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-labelledby");
    await waitFor(() => expect(dialog.querySelector("h2")).toHaveTextContent("ECC production"));
    await waitFor(() => expect(screen.getByText("Last extraction")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Facts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByText("ECC 6.0 EHP8, client 100")).toBeInTheDocument();
  });

  it("says plainly that a system never extracted has not been extracted, and offers the extraction", async () => {
    setUrl(`/?open=system:${SF.id}`);
    renderWithQuery(<Harness />);
    expect(await screen.findByText("Not extracted yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extract" })).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("opens a rule with its scope, each object a link (the rule body is covered in RuleInspector.test.tsx)", async () => {
    setUrl("/?open=rule:MM014");
    renderWithQuery(<Harness />);
    const dialog = await screen.findByRole("dialog");
    const scope = await within(dialog).findByRole("region", { name: /^Scope/ });
    expect(dialog).toHaveTextContent("MM014");
    expect(within(scope).getByRole("link", { name: "Material master" })).toHaveAttribute("href", expect.stringContaining("/o/ecc-production/material-master"));
    expect(within(dialog).getByRole("link", { name: "Open the rule" })).toBeInTheDocument();
  });

  it("opens a record by its key: the title is the key in mono and the body is the record (see RecordInspector.test)", async () => {
    setUrl("/?open=record:material_master%3AMATNR%3D000000000000000101");
    renderWithQuery(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    expect(await screen.findByRole("heading", { level: 2, name: "000000000000000101" })).toBeInTheDocument();
    expect(await screen.findByTestId("record-facts")).toBeInTheDocument();
  });

  it("renders nothing when nothing is open", () => {
    renderWithQuery(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains a system that is not in the tenant", async () => {
    setUrl("/?open=system:missing");
    renderWithQuery(<Harness />);
    expect(await screen.findByText(/This system is not in the tenant/)).toBeInTheDocument();
  });
});

describe("focus handling", () => {
  it("moves focus to Close on open, cycles Tab inside, and returns focus to the opener on Esc", async () => {
    renderWithQuery(<Harness />);
    const opener = screen.getByText("Open ECC");
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    const close = screen.getByRole("button", { name: "Close inspector" });
    await waitFor(() => expect(close).toHaveFocus());
    await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument());
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
    const last = focusables[focusables.length - 1];
    expect(focusables[0]).toBe(close);
    expect(focusables.length).toBeGreaterThan(1);

    // Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last.
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    // Esc closes it, the URL loses ?open=, and focus goes back to the control that opened it.
    fireEvent.keyDown(last, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(getUrl()).not.toContain("open=");
    expect(opener).toHaveFocus();
  });

  it("falls back to the canvas when the opener is gone", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [hasOpener, setHasOpener] = useState(true);
      return (
        <div>
          {hasOpener ? <button onClick={() => setOpen(true)}>Opener</button> : null}
          <main id="m2-canvas" tabIndex={-1} />
          {open ? (
            <InspectorFrame
              title="Rule"
              onClose={() => {
                setHasOpener(false);
                setOpen(false);
              }}
            >
              <a href="#x">one</a>
            </InspectorFrame>
          ) : null}
        </div>
      );
    }
    renderWithQuery(<Host />);
    const opener = screen.getByText("Opener");
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.getElementById("m2-canvas")).toHaveFocus();
  });

  it("Esc inside the frame asks to close, once", () => {
    const onClose = vi.fn();
    renderWithQuery(
      <InspectorFrame title="Rule" onClose={onClose}>
        <a href="#x">one</a>
      </InspectorFrame>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the other controls on the page stay out of the cycle: Tab from Close goes forward inside the dialog only", async () => {
    renderWithQuery(<Harness />);
    fireEvent.click(screen.getByText("Open rule"));
    const dialog = await screen.findByRole("dialog");
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
    expect(items.every((el) => dialog.contains(el))).toBe(true);
    expect(dialog.contains(screen.getByText("Last control"))).toBe(false);
  });
});
