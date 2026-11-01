// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch24 — agent heartbeat/state and jsonl stream edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parseAgents reads heartbeat and state files when present", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b24-${randomUUID()}-`));
    const agentDir = path.join(root, "agent-b24");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# alive\n", "utf8");
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT_STATE.md"), "task: batch24\n", "utf8");
    const agents = await parseAgents(root);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe("agent-b24");
    expect(agents[0]?.currentTask).toContain("batch24");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseModelUsage aggregates duplicate requestId only once and skips malformed lines", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b24-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    const projectDir = path.join(home, ".claude", "projects", "proj-b24");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "session.jsonl"),
      [
        "not-json",
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-10-30T00:00:00.000Z",
          requestId: "dup-b24",
          message: {
            model: "claude-dup-b24",
            usage: { input_tokens: 4, output_tokens: 1 },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-10-30T00:00:01.000Z",
          requestId: "dup-b24",
          message: {
            model: "claude-dup-b24",
            usage: { input_tokens: 99, output_tokens: 99 },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-10-30T00:00:02.000Z",
          message: {
            model: "claude-long-name-over-twenty-chars",
            usage: { input_tokens: 2, output_tokens: 1 },
          },
        }),
      ].join("\n"),
      "utf8",
    );
    try {
      const usage = await parseModelUsage(new Date("2026-10-01T00:00:00.000Z"));
      const dup = usage.models.find((m) => m.id === "claude-dup-b24");
      expect(dup?.requests).toBe(1);
      expect(dup?.inputTokens).toBe(4);
      const long = usage.models.find((m) => m.id === "claude-long-name-over-twenty-chars");
      expect(long?.name.length).toBeLessThanOrEqual(20);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
