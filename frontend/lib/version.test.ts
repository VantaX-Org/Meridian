import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("APP_VERSION", () => {
  it.each(["v0.0.358", "0.0.358"])("shows %s as 0.0.358", async (v) => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", v);
    vi.resetModules();
    expect((await import("./version")).APP_VERSION).toBe("0.0.358");
  });
});
