// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  negotiateDescriptor,
  resolveRegisteredTool,
  validateInitializeParams,
  validateJsonRpcEnvelope,
} from "../mcp-protocol";

const FULL_CAPS = [
  { name: "memory.read", source: "msiq" },
  { name: "memory.write", source: "msiq" },
  { name: "memory.search", source: "msiq" },
  { name: "tools.list", source: "msiq" },
];

const FULL_TOOLS = [
  { name: "memory_read" },
  { name: "memory_write" },
  { name: "memory_search" },
];

describe("msiq mcp-protocol batch20b", () => {
  it("validateJsonRpcEnvelope rejects unknown top-level fields", () => {
    const result = validateJsonRpcEnvelope({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
      extra: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_jsonrpc_envelope");
  });

  it("validateInitializeParams rejects unsupported protocol versions", () => {
    const result = validateInitializeParams({
      protocolVersion: "2099-01-01",
      capabilities: FULL_CAPS,
      clientInfo: { name: "memroos", version: "1.0.0" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_protocol_version");
  });

  it("negotiateDescriptor fails on unsupported transport", () => {
    const outcome = negotiateDescriptor({
      transport: "hosted-cloud",
      initialize: {
        protocolVersion: "2024-11-05",
        capabilities: FULL_CAPS,
        serverInfo: { name: "msiq", version: "1" },
        tools: FULL_TOOLS,
      },
      transcript: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported_transport");
  });

  it("negotiateDescriptor succeeds for self-hosted transport with required tools", () => {
    const outcome = negotiateDescriptor({
      transport: "mcp_stdio",
      initialize: {
        protocolVersion: "2025-03-26",
        capabilities: FULL_CAPS,
        serverInfo: { name: "msiq", version: "1" },
        tools: FULL_TOOLS,
      },
      transcript: [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }],
    });
    expect(outcome.ok).toBe(true);
  });

  it("resolveRegisteredTool enforces declared scope and capabilities", () => {
    const tools = [
      {
        name: "memory_read",
        requiredScope: ["tenant"],
        requiredCapabilities: ["memory.read"],
      },
    ];
    expect(resolveRegisteredTool({ tools, name: "memory_read", requestedScope: ["tenant"], requestedCapabilities: ["memory.read"] }).ok).toBe(
      true,
    );
    expect(resolveRegisteredTool({ tools, name: "memory_read", requestedScope: ["tenant"] }).ok).toBe(false);
    expect(resolveRegisteredTool({ tools, name: "missing_tool" }).ok).toBe(false);
  });
});
