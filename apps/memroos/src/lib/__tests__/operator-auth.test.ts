// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { authorizeRegistryWrite } from "@/lib/operator-auth";

describe("authorizeRegistryWrite", () => {
  afterEach(() => {
    delete process.env.MEMROOS_OPERATOR_API_KEY;
  });

  it("allows loopback registry writes without an operator key", () => {
    expect(authorizeRegistryWrite(new Request("http://localhost/api/agents/register"))).toBe(true);
    expect(authorizeRegistryWrite(new Request("http://127.0.0.1/api/agents/register"))).toBe(true); // pragma: allowlist secret
  });

  it("allows loopback dashboard calls even when an operator key is configured", () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";

    expect(authorizeRegistryWrite(new Request("http://localhost/api/memory/health"))).toBe(true);
    expect(authorizeRegistryWrite(new Request("http://127.0.0.1/api/orchestration/hil"))).toBe(true); // pragma: allowlist secret
  });

  it("does not treat a public forwarded host as local loopback", () => {
    // CR-08: x-forwarded-host is ignored; a spoofed "localhost" header cannot
    // elevate a public-origin request to loopback trust.
    expect(
      authorizeRegistryWrite(
        new Request("https://memroos.example.com/api/agents/register", {
          headers: { "x-forwarded-host": "localhost" },
        })
      )
    ).toBe(false);
  });

  it("parses bracketed IPv6 host headers for loopback detection", () => {
    expect(
      authorizeRegistryWrite(
        new Request("http://127.0.0.1/api/agents/register", { // pragma: allowlist secret
          headers: { host: "[::1]:3000" },
        })
      )
    ).toBe(true);
  });

  it("falls back to Host header when request URL hostname is 0.0.0.0", () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";
    expect(
      authorizeRegistryWrite(
        new Request("http://0.0.0.0/api/agents/register", {
          headers: { host: "memroos.example.com" },
        })
      )
    ).toBe(false);
    expect(
      authorizeRegistryWrite(
        new Request("http://0.0.0.0/api/agents/register", {
          headers: { host: "memroos.example.com", "x-memroos-operator-key": "operator-secret" },
        })
      )
    ).toBe(true);
  });

  it("blocks non-local registry writes unless the operator key matches", () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret";

    expect(authorizeRegistryWrite(new Request("https://memroos.example.com/api/agents/register"))).toBe(false);
    expect(
      authorizeRegistryWrite(
        new Request("https://memroos.example.com/api/agents/register", {
          headers: { "x-memroos-operator-key": "operator-secret" },
        })
      )
    ).toBe(true);
    expect(
      authorizeRegistryWrite(
        new Request("https://memroos.example.com/api/agents/register", {
          headers: { authorization: "Bearer operator-secret" },
        })
      )
    ).toBe(true);
  });
});
