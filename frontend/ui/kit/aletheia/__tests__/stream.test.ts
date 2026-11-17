import { describe, expect, it } from "vitest";
import { buildBody } from "../stream";

describe("buildBody", () => {
  it("sends only the allowed keys", () => {
    const b = buildBody("why?", { version_id: "v1", module: "material_master", check_id: "R1", record_key: "K1" });
    expect(Object.keys(b).sort()).toEqual(["check_id", "module", "question", "record_key", "scope", "version_id"]);
  });
  it("omits unset context", () => {
    expect(buildBody("hi", {})).toEqual({ question: "hi", scope: "current" });
  });
});
