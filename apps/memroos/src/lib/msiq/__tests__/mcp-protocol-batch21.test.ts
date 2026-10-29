// @vitest-environment node
import { describe, expect, it } from "vitest";

import { negotiateDescriptor, validateInitializeParams, validateJsonRpcEnvelope } from "../mcp-protocol";

const FULL_CAPS = [
  { name: "memory.read", source: "msiq" },
  { name: "memory.write", source: "msiq" },
  { name: "memory.search", source: "msiq" },
  { name: "tools.list", source: "msiq" },
];

const FULL_TOOLS = [{ name: "memory_read" }, { name: "memory_write" }, { name: "memory_search" }];

describe("msiq mcp-protocol batch21", () => {
  it("validateJsonRpcEnvelope rejects empty method strings", () => {
    const result = validateJsonRpcEnvelope({ jsonrpc: "2.0", id: 1, method: "", params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/method must be a non-empty string/);
  });

  it("validateInitializeParams rejects non-string protocolVersion values", () => {
    const result = validateInitializeParams({
      protocolVersion: 2024,
      capabilities: FULL_CAPS,
      clientInfo: { name: "memroos", version: "1.0.0" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/protocolVersion must be a string/);
  });

  it("negotiateDescriptor fails when initialize advertises unsupported protocol versions", () => {
    const outcome = negotiateDescriptor({
      transport: "mcp_stdio",
      initialize: {
        protocolVersion: "2099-01-01",
        capabilities: FULL_CAPS,
        serverInfo: { name: "msiq", version: "1" },
        tools: FULL_TOOLS,
      },
      transcript: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported_protocol_version");
  });
});
