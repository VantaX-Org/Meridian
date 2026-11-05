import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "../proxy";

/** Fails if the Content-Security-Policy stops reaching the browser on a page, signed in or not. */
describe("Content-Security-Policy", () => {
  it.each([
    ["signed in", "http://localhost/work", { cookie: "mn_session=1" }],
    ["sign-in page", "http://localhost/sign-in", {}],
  ])("is set on the %s response with a fresh nonce", (_name, url, headers) => {
    const res = proxy(new NextRequest(url, { headers }));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"]) {
      expect(csp).toContain(d);
    }
    const again = proxy(new NextRequest(url, { headers })).headers.get("content-security-policy");
    expect(again).not.toBe(csp);
  });
});
