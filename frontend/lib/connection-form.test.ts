import { describe, expect, it } from "vitest";
import { validate } from "@/lib/forms";
import { connectionKey, connectionOf, EMPTY, schemaFor, type ConnectionValues } from "./connection-form";

const rfc = (patch: Partial<ConnectionValues> = {}): ConnectionValues => ({
  ...EMPTY, name: "ECC", host: "sap-ecc.internal", client: "100", sysnr: "00", password: "pw", ...patch,
});
const errors = (v: ConnectionValues, snc = v.snc_mode === "1") => validate(schemaFor("ecc", "rfc", { snc }), v).errors;

describe("SAProuter and SNC on an RFC connection", () => {
  it("accepts a direct connection and a router string with a trailing hop", () => {
    expect(errors(rfc())).toEqual({});
    expect(errors(rfc({ saprouter: "/H/router.example.com/S/3299/H/" }))).toEqual({});
  });

  it("refuses a malformed router string and one carrying a password", () => {
    expect(errors(rfc({ saprouter: "router.example.com:3299" })).saprouter).toBeTruthy();
    expect(errors(rfc({ saprouter: "/H/r/S/3299/W/secret/H/" })).saprouter).toMatch(/password/);
  });

  it("needs the partner name only when SNC is on, and a known protection level", () => {
    expect(errors(rfc({ snc_partnername: "" }), false).snc_partnername).toBeUndefined();
    expect(errors(rfc({ snc_mode: "1" })).snc_partnername).toBeTruthy();
    expect(errors(rfc({ snc_mode: "1", snc_partnername: "p:CN=ECC", snc_qop: "9" }))).toEqual({});
    expect(errors(rfc({ snc_mode: "1", snc_partnername: "p:CN=ECC", snc_qop: "5" })).snc_qop).toBeTruthy();
  });

  it("sends the route settings, drops SNC names when SNC is off, and never puts the password in the connection", () => {
    const on = connectionOf(rfc({ saprouter: " /H/r/S/3299 ", snc_mode: "1", snc_partnername: "p:CN=ECC", snc_qop: "3", snc_myname: "p:CN=MER" }));
    expect(on.connection).toMatchObject({ saprouter: "/H/r/S/3299", snc_mode: true, snc_partnername: "p:CN=ECC", snc_qop: "3", snc_myname: "p:CN=MER" });
    expect(on.credentials).toEqual({ password: "pw" });
    expect(JSON.stringify(on.connection)).not.toContain("pw");
    const off = connectionOf(rfc({ snc_partnername: "p:CN=ECC", snc_qop: "3" }));
    expect(off.connection).toMatchObject({ snc_mode: false, snc_partnername: "", snc_qop: "" });
  });

  it("leaves cloud connections without route settings", () => {
    const c = connectionOf({ ...EMPTY, system_type: "successfactors", auth_type: "basic", base_url: "https://api.sf", saprouter: "/H/r" });
    expect(c.connection).not.toHaveProperty("saprouter");
    expect(c.connection).not.toHaveProperty("snc_mode");
  });

  it("makes an earlier test stale when the router or SNC changes", () => {
    expect(connectionKey(rfc())).not.toBe(connectionKey(rfc({ saprouter: "/H/r" })));
    expect(connectionKey(rfc())).not.toBe(connectionKey(rfc({ snc_mode: "1" })));
  });
});
