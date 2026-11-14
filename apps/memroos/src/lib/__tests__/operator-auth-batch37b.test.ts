// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizeRegistryWrite } from "@/lib/operator-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("operator-auth batch37b — host parsing", () => {
  it("authorizeRegistryWrite allows localhost via plain Host header (11)", () => {
    const req = new Request("http://0.0.0.0/api/agents/register", {
      headers: { host: "localhost:3000" },
    });
    expect(authorizeRegistryWrite(req)).toBe(true);
  });

  it("authorizeRegistryWrite honors operator key when host is not loopback", () => {
    vi.stubEnv("MEMROOS_OPERATOR_API_KEY", "operator-key-b37b");
    const req = new Request("http://example.test/api/agents/register", {
      headers: { "x-memroos-operator-key": "operator-key-b37b" },
    });
    expect(authorizeRegistryWrite(req)).toBe(true);
  });
});