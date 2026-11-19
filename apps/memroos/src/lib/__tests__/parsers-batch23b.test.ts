// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch23b — dormant agents and jsonl stream edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parseAgents marks agents dormant when heartbeat mtime is older than 24 hours", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-dormant-b23b-${randomUUID()}-`));
    const agentDir = path.join(root, "dormant-agent-b23b");
    fs.mkdirSync(agentDir, { recursive: true });
    const heartbeat = path.join(agentDir, "HEARTBEAT.md");
    fs.writeFileSync(heartbeat, "STATUS: ok", "utf8");
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(heartbeat, old, old);
    const agents = await parseAgents(root);
    expect(agents[0]?.status).toBe("dormant");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseAgents ignores entries that are not directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b23b-${randomUUID()}-`));
    fs.writeFileSync(path.join(root, "file-not-dir"), "x", "utf8");
    const agents = await parseAgents(root);
    expect(agents).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseModelUsage returns empty usage when no recent jsonl exists", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b23b-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    fs.mkdirSync(path.join(home, ".claude", "projects", "empty-proj"), { recursive: true });
    try {
      const usage = await parseModelUsage(new Date("2026-10-01T00:00:00.000Z"));
      expect(usage.models.length).toBe(0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
