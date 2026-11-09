// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

import { getLocalAgentRuntime, summarizeAgentCliProcesses } from "@/lib/local-agent-runtime";

describe("local-agent-runtime batch24 — platform detection edges", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects grok, droid, gemini, and openclaw node entrypoints", () => {
    const summary = summarizeAgentCliProcesses(
      [
        " 100     1 /usr/local/bin/grok chat",
        " 101     1 /usr/local/bin/droid run",
        " 102     1 /usr/local/bin/gemini",
        " 103     1 node /home/dev/node_modules/openclaw/dist/index.js gateway",
      ].join("\n"),
      "2026-10-31T00:00:00.000Z",
    );
    expect(summary.byPlatform.grok).toBe(1);
    expect(summary.byPlatform.droid).toBe(1);
    expect(summary.byPlatform.gemini).toBe(1);
    expect(summary.byPlatform.openclaw).toBe(1);
  });

  it("getLocalAgentRuntime returns empty summary when ps fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("ps unavailable");
    });
    const summary = getLocalAgentRuntime();
    expect(summary.activeCliCount).toBe(0);
    expect(summary.byPlatform).toEqual({});
  });
});
