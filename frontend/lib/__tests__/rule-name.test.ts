import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as rulesApi from "@/lib/api/rules";
import { ddicRuleName, loadRuleName, plainRuleName, rankedName, ruleWords, useRuleNames } from "@/lib/rule-name";

afterEach(() => vi.restoreAllMocks());

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
};

describe("ddicRuleName", () => {
  it("names each DDIC conformance kind with its table", () => {
    expect(ddicRuleName("DDIC-MARA-TYPE")).toBe("Value does not match the field's SAP data type (MARA)");
    expect(ddicRuleName("DDIC-BSIK-LENGTH")).toBe("Value exceeds the field's SAP length or precision (BSIK)");
    expect(ddicRuleName("DDIC-ADRC-CASE")).toBe("Lower-case value in an upper-case SAP field (ADRC)");
    expect(ddicRuleName("DDIC-BUT000-FIXED_VALUE")).toBe("Value is not one of the domain's fixed values (BUT000)");
    expect(ddicRuleName("DDIC-T001-CHECK_TABLE")).toBe("Value does not exist in the source system's check table (T001)");
  });

  it("leaves any other id unnamed", () => {
    expect(ddicRuleName("MM045")).toBeNull();
    expect(ddicRuleName("DDIC-MARA-OTHER")).toBeNull();
    expect(ddicRuleName(null)).toBeNull();
  });
});

describe("plain rule names", () => {
  it("strips the catalogue's 'ID: ' prefix and nothing else", () => {
    expect(plainRuleName("MM045", "MM045: Material type missing")).toBe("Material type missing");
    expect(plainRuleName("MM045", "Material type missing")).toBe("Material type missing");
    expect(plainRuleName("MM045", "MM0450: Other rule")).toBe("MM0450: Other rule");
    expect(plainRuleName("MM045", "  ")).toBeNull();
    expect(plainRuleName("MM045", null)).toBeNull();
  });

  it("treats a name that only repeats the id as no name", () => {
    expect(ruleWords("MM045", "MM045")).toBeUndefined();
    expect(ruleWords("MM045", "MM045: Material type missing")).toBe("Material type missing");
    expect(rankedName([{ check_id: "MM045", name: "MM045" }], "MM045")).toBeUndefined();
    expect(rankedName([{ check_id: "MM045", name: "Material type missing" }], "MM045")).toBe("Material type missing");
    expect(rankedName(undefined, "MM045")).toBeUndefined();
  });
});

describe("loadRuleName", () => {
  it("sends the ids asked for in one tick as one request and resolves each with its plain name", async () => {
    const get = vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({ MM045: "Material type missing", AP001: "AP001: Vendor blocked" });
    const names = await Promise.all([loadRuleName("MM045"), loadRuleName("AP001"), loadRuleName("ZZ999"), loadRuleName("MM045")]);
    expect(names).toEqual(["Material type missing", "Vendor blocked", null, "Material type missing"]);
    expect(get).toHaveBeenCalledTimes(1);
    expect([...get.mock.calls[0][0]].sort()).toEqual(["AP001", "MM045", "ZZ999"]);
  });

  it("rejects the waiting ids when the request fails", async () => {
    vi.spyOn(rulesApi, "getRuleNames").mockRejectedValue(new Error("403"));
    await expect(loadRuleName("MM045")).rejects.toThrow("403");
  });
});

describe("useRuleNames", () => {
  it("names the ids a page shows from the names endpoint (never the 1,000-row rules list) and DDIC ids locally", async () => {
    const list = vi.spyOn(rulesApi, "getRules");
    const get = vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({ MM045: "Material type missing" });
    const { result } = renderHook(() => useRuleNames(["MM045", "DDIC-MARA-TYPE", "ZZ999", null, "MM045"]), { wrapper: wrapper() });
    expect(result.current("DDIC-MARA-TYPE")).toBe("Value does not match the field's SAP data type (MARA)");
    await waitFor(() => expect(result.current("MM045")).toBe("Material type missing"));
    expect(result.current("ZZ999")).toBeUndefined();
    // a DDIC id is never sent; each other id once
    expect(get).toHaveBeenCalledTimes(1);
    expect([...get.mock.calls[0][0]].sort()).toEqual(["MM045", "ZZ999"]);
    expect(list).not.toHaveBeenCalled();
  });

  it("asks for nothing while disabled", async () => {
    const get = vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({});
    const { result } = renderHook(() => useRuleNames(["MM045"], false), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(get).not.toHaveBeenCalled();
    expect(result.current("MM045")).toBeUndefined();
  });
});
