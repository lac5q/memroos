// @vitest-environment node
import { describe, expect, it } from "vitest";

import { validateInitializeParams } from "../mcp-protocol";

describe("msiq mcp-protocol batch33b", () => {
  it("validateInitializeParams rejects non-array capabilities (129)", () => {
    const result = validateInitializeParams({
      protocolVersion: "2024-11-05",
      capabilities: { name: "memory.read", source: "msiq" },
      clientInfo: { name: "batch33b", version: "1.0.0" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("capabilities");
  });

  it("validateInitializeParams rejects non-record capability entries (132)", () => {
    const result = validateInitializeParams({
      protocolVersion: "2024-11-05",
      capabilities: ["memory.read", 42],
      clientInfo: { name: "batch33b", version: "1.0.0" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("capabilities");
  });
});
