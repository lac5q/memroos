// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarizeAgentCliProcesses } from "@/lib/local-agent-runtime";

describe("local-agent-runtime batch16", () => {
  it("detects grok, droid, zcode, and openclaw CLI processes in ps output", () => {
    const psOutput = [
      " 101 1 /usr/local/bin/grok chat",
      " 102 1 /usr/local/bin/droid run",
      " 103 1 /usr/local/bin/zcode serve",
      " 104 1 node /repo/node_modules/openclaw/dist/index.js worker",
    ].join("\n");

    const summary = summarizeAgentCliProcesses(psOutput, "2026-10-23T12:00:00.000Z");
    expect(summary.activeCliCount).toBe(4);
    expect(summary.byPlatform.grok).toBe(1);
    expect(summary.byPlatform.droid).toBe(1);
    expect(summary.byPlatform.zcode).toBe(1);
    expect(summary.byPlatform.openclaw).toBe(1);
  });
});
