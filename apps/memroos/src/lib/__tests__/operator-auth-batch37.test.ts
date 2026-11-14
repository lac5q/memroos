// @vitest-environment node
import { describe, expect, it } from "vitest";

import { authorizeRegistryWrite } from "@/lib/operator-auth";

describe("operator-auth batch37 — hostnameFromHostHeader (9)", () => {
  it("authorizeRegistryWrite treats bracketed IPv6 Host header as loopback", () => {
    const req = new Request("http://0.0.0.0/api/agents/register", {
      headers: { host: "[::1]:3000" },
    });
    expect(authorizeRegistryWrite(req)).toBe(true);
  });
});