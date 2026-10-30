import { describe, expect, it } from "vitest";
import { crmKeyMatches } from "../lib/crm";

describe("CRM API key", () => {
  it("is off when no key is configured", () => {
    expect(crmKeyMatches("anything", "")).toBe(false);
    expect(crmKeyMatches("anything", undefined)).toBe(false);
  });

  it("only accepts the exact key", () => {
    expect(crmKeyMatches("s3cret-key", "s3cret-key")).toBe(true);
    expect(crmKeyMatches("s3cret-kez", "s3cret-key")).toBe(false);
    expect(crmKeyMatches("s3cret", "s3cret-key")).toBe(false);
    expect(crmKeyMatches(null, "s3cret-key")).toBe(false);
  });
});
