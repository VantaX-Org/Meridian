import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePaletteContext, useRegisteredCommands } from "./paletteContext";

describe("paletteContext", () => {
  it("registers commands while mounted and clears them on unmount", () => {
    const cmds = [{ id: "a", label: "A", run: () => undefined }];
    const reg = renderHook(() => usePaletteContext("Here", cmds));
    const read = renderHook(() => useRegisteredCommands());
    expect(read.result.current.label).toBe("Here");
    expect(read.result.current.commands.map((c) => c.id)).toEqual(["a"]);
    reg.unmount();
    expect(renderHook(() => useRegisteredCommands()).result.current.commands).toEqual([]);
  });
});
