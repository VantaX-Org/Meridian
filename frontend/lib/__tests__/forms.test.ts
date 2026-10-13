import { describe, expect, it } from "vitest";
import { email, int, length, oneOf, pattern, required, url, validate } from "../forms";

describe("rules", () => {
  it("required rejects empty and whitespace only", () => {
    expect(required()("")).toBeDefined();
    expect(required()("   ")).toBeDefined();
    expect(required("Enter a name")("")).toBe("Enter a name");
    expect(required()("x")).toBeUndefined();
  });

  it("every other rule lets an empty value through", () => {
    for (const rule of [email(), url(), int(1, 5), oneOf(["a"]), length(2, 4), pattern(/^\d+$/, "digits")]) {
      expect(rule("")).toBeUndefined();
    }
  });

  it("email", () => {
    expect(email()("a@b.co")).toBeUndefined();
    expect(email()("a@b")).toBeDefined();
    expect(email()("not an email")).toBeDefined();
  });

  it("url accepts http and https only", () => {
    expect(url()("https://example.com/x")).toBeUndefined();
    expect(url()("http://example.com")).toBeUndefined();
    expect(url()("ftp://example.com")).toBeDefined();
    expect(url()("example.com")).toBeDefined();
    expect(url()("javascript:alert(1)")).toBeDefined();
  });

  it("int checks whole numbers and the range", () => {
    expect(int(1, 10)("5")).toBeUndefined();
    expect(int(1, 10)("1")).toBeUndefined();
    expect(int(1, 10)("10")).toBeUndefined();
    expect(int(1, 10)("0")).toBe("Enter a whole number from 1 to 10");
    expect(int(1, 10)("11")).toBeDefined();
    expect(int(1, 10)("2.5")).toBeDefined();
    expect(int(1, 10)("abc")).toBeDefined();
  });

  it("oneOf", () => {
    expect(oneOf(["a", "b"])("a")).toBeUndefined();
    expect(oneOf(["a", "b"])("c")).toBe("Choose one of a, b");
  });

  it("length and pattern", () => {
    expect(length(16, 256)("short")).toBeDefined();
    expect(length(2, 4)("abc")).toBeUndefined();
    expect(pattern(/^\d{3}$/, "Enter a 3-digit client")("12")).toBe("Enter a 3-digit client");
    expect(pattern(/^\d{3}$/, "x")("123")).toBeUndefined();
  });
});

describe("validate", () => {
  const schema = { name: required("Enter a name"), mail: [required("Enter an email"), email()], port: int(1, 65535) };

  it("is valid when every rule passes", () => {
    expect(validate(schema, { name: "A", mail: "a@b.co", port: "" })).toEqual({ errors: {}, valid: true });
  });

  it("returns the first failing message per field", () => {
    const r = validate(schema, { name: "", mail: "", port: "0" });
    expect(r.valid).toBe(false);
    expect(r.errors.name).toBe("Enter a name");
    expect(r.errors.mail).toBe("Enter an email");
    expect(r.errors.port).toContain("1 to 65,535");
  });

  it("applies later rules once the earlier ones pass", () => {
    expect(validate(schema, { name: "A", mail: "nope", port: "" }).errors.mail).toBe("Enter a valid email address");
  });

  it("ignores fields with no rule", () => {
    expect(validate({ a: undefined }, { a: "", b: "" }).valid).toBe(true);
  });
});
