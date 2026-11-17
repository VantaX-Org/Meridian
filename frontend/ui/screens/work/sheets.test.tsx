import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost, useSheet } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { getRecord } from "@/lib/api/v2/work";
import { RecordDetail } from "./RecordDetail";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/work", async (orig) => {
  const m = await orig<typeof import("@/lib/api/v2/work")>();
  return { ...m, getRecord: vi.fn(m.getRecord) };
});
vi.mock("./RecordDetail", async (orig) => {
  const m = await orig<typeof import("./RecordDetail")>();
  return { RecordDetail: vi.fn(m.RecordDetail) };
});

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); vi.mocked(getRecord).mockClear(); vi.mocked(RecordDetail).mockClear(); });
afterEach(() => undo());

const host = (child: ReactNode = null) =>
  renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close">{child}</SheetHost></AletheiaProvider>);

const lastProps = () => vi.mocked(RecordDetail).mock.calls.at(-1)?.[0];

describe("record sheet version", () => {
  it("a caller's version reaches RecordDetail and the record read", async () => {
    window.history.replaceState(null, "", "/work?fixture=1");
    const Opener = () => {
      const { open } = useSheet();
      useEffect(() => open("record", { module: "material_master", recordKey: "MATNR=1", version: "v-7" }), [open]);
      return null;
    };
    host(<Opener />);
    await waitFor(() => expect(getRecord).toHaveBeenCalledWith("material_master", "MATNR=1", "v-7"));
    expect(lastProps()).toMatchObject({ module: "material_master", recordKey: "MATNR=1", version: "v-7" });
  });

  it("the deep link takes the record from ?open= and the version from ?run=", async () => {
    window.history.replaceState(null, "", "/o/ecc/material-master?fixture=1&run=v-9&open=record%3Amaterial_master%3AMATNR%3D1");
    host();
    await waitFor(() => expect(getRecord).toHaveBeenCalledWith("material_master", "MATNR=1", "v-9"));
    expect(lastProps()).toMatchObject({ module: "material_master", recordKey: "MATNR=1", version: "v-9" });
  });

  it("with no version anywhere it reads the latest run, as before", async () => {
    window.history.replaceState(null, "", "/work?fixture=1&open=record%3Amaterial_master%3AMATNR%3D1");
    host();
    await waitFor(() => expect(getRecord).toHaveBeenCalledWith("material_master", "MATNR=1", undefined));
    expect(lastProps()?.version).toBeUndefined();
  });
});
