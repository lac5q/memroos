// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch27 — directory skips and stale jsonl files", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parseAgents skips non-directory entries under the configs root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b27-${randomUUID()}-`));
    fs.writeFileSync(path.join(root, "not-a-dir.txt"), "skip me", "utf8");
    const agentDir = path.join(root, "agent-b27");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# ok\n", "utf8");
    try {
      const agents = await parseAgents(root);
      expect(agents).toHaveLength(1);
      expect(agents[0]?.id).toBe("agent-b27");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("parseModelUsage ignores jsonl files older than the since cutoff", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b27-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    const projectDir = path.join(home, ".claude", "projects", "proj-b27");
    fs.mkdirSync(projectDir, { recursive: true });
    const stalePath = path.join(projectDir, "stale.jsonl");
    fs.writeFileSync(
      stalePath,
      JSON.stringify({
        type: "assistant",
        timestamp: "2020-01-01T00:00:00.000Z",
        message: { model: "claude-stale-b27", usage: { input_tokens: 9, output_tokens: 1 } },
      }),
      "utf8",
    );
    const old = new Date("2019-06-01T00:00:00.000Z");
    fs.utimesSync(stalePath, old, old);
    try {
      const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
      expect(usage.models.find((m) => m.id === "claude-stale-b27")).toBeUndefined();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

});
