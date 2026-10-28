// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseAgents, parseClaudeMemory, parseModelUsage } from "@/lib/parsers";

describe("parsers batch16c — platform labels and memory file parsing", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("parseAgents assigns platform labels from agent directory names", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b16c-${crypto.randomUUID()}-`));
    roots.push(root);
    for (const [dir, platform] of [
      ["hermes-ops-agent", "hermes"],
      ["openclaw-worker", "openclaw"],
      ["qwen-researcher", "qwen"],
      ["codex-builder", "codex"],
    ] as const) {
      const agentDir = path.join(root, dir);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "SOUL.md"), "Soul", "utf8");
      fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "STATUS: active", "utf8");
      const agents = await parseAgents(root);
      const agent = agents.find((a) => a.id === dir);
      expect(agent?.platform).toBe(platform);
    }
  });

  it("parseClaudeMemory returns empty array when memory directory missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `mem-b16c-${crypto.randomUUID()}-`));
    roots.push(root);
    const entries = await parseClaudeMemory(root);
    expect(entries).toEqual([]);
  });

  it("parseClaudeMemory reads dated markdown files under project/memory/", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `mem-b16c2-${crypto.randomUUID()}-`));
    roots.push(root);
    const projectDir = path.join(root, "project-alpha");
    const memDir = path.join(projectDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "2026-07-01-note.md"), "Captured insight", "utf8");
    const entries = await parseClaudeMemory(root);
    expect(entries.some((e) => e.content.includes("Captured insight"))).toBe(true);
  });

  it("parseModelUsage returns zero totals when no Claude project logs exist", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b16c-${crypto.randomUUID()}-`));
    roots.push(home);
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.total.requests).toBe(0);
    process.env.HOME = previousHome;
  });
});
