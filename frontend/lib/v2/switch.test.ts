import { beforeEach, describe, expect, it } from "vitest";
import { readUiCookie, setUiCookie, UI_COOKIE, UI_V2 } from "./switch";

beforeEach(() => {
  document.cookie = `${UI_COOKIE}=; Path=/; Max-Age=0`;
});

describe("interface switch cookie", () => {
  it("is mn_ui=v2", () => {
    expect(UI_COOKIE).toBe("mn_ui");
    expect(UI_V2).toBe("v2");
  });

  it("reads nothing when it was never set", () => {
    expect(readUiCookie()).toBeNull();
  });

  it("sets and reads mn_ui=v2 among other cookies", () => {
    document.cookie = "mn_session=1; Path=/";
    setUiCookie("v2");
    expect(document.cookie).toContain("mn_ui=v2");
    expect(readUiCookie()).toBe("v2");
    expect(document.cookie).toContain("mn_session=1");
  });

  it("clears it", () => {
    setUiCookie("v2");
    setUiCookie(null);
    expect(readUiCookie()).toBeNull();
  });

  it("parses a cookie string it is given", () => {
    expect(readUiCookie("a=1; mn_ui=v2; b=2")).toBe("v2");
    expect(readUiCookie("a=1; b=2")).toBeNull();
    expect(readUiCookie("mn_ui=")).toBeNull();
    expect(readUiCookie("xmn_ui=v2")).toBeNull();
  });
});
