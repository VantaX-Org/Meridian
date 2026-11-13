import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { push, setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { SheetHost, registerSheet, useSheets, type SheetsApi } from "../shell/SheetHost";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
const got: SheetsApi[] = [];
function Probe() {
  const a = useSheets();
  useEffect(() => {
    got.push(a);
  });
  return null;
}
beforeEach(() => {
  undo = stubLayout();
  setUrl("/work");
  push.mockClear();
  registerSheet("probe", (ctx) => <p>probe sheet {ctx.id}</p>);
});
afterEach(() => undo());

describe("SheetHost", () => {
  it("pushes an address when a sheet opens and shows the registered body", () => {
    setUrl("/work?sheet=probe:7");
    renderWithQuery(<SheetHost><Probe /></SheetHost>);
    expect(screen.getByText("probe sheet 7")).toBeInTheDocument();
    expect(got.at(-1)!.stack).toHaveLength(1);
    act(() => got.at(-1)!.open({ kind: "probe", id: "9" }));
    expect(push.mock.calls.at(-1)?.[0]).toContain("probe");
  });
});
