// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch16 — parseAgents and model normalization branches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parseAgents skips non-directories and extracts company, master, lessons, and memory counts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b16-${crypto.randomUUID()}-`));
    fs.writeFileSync(path.join(root, "readme.txt"), "not a dir", "utf8");

    const agentId = `popsmiths-ceo-${crypto.randomUUID().slice(0, 6)}`;
    const agentDir = path.join(root, agentId);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "SOUL.md"), "We serve PopSmiths customers.", "utf8");
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "OpenClaw platform notes only.", "utf8");
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT_STATE.md"), "# Fix checkout regression\n", "utf8");
    fs.writeFileSync(path.join(agentDir, "LESSONS.md"), "- lesson one\n- lesson two\n", "utf8");
    fs.writeFileSync(path.join(agentDir, "AGENTS.md"), "Reports to Hermes master agent.", "utf8");
    const memDir = path.join(agentDir, "memory");
    fs.mkdirSync(memDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(memDir, `${today}-note.md`), "today", "utf8");

    const agents = await parseAgents(root);
    const agent = agents.find((a) => a.id === agentId);
    expect(agent?.company).toBe("PopSmiths");
    expect(agent?.masterId).toBe("hermes");
    expect(agent?.lessonsCount).toBe(2);
    expect(agent?.todayMemoryCount).toBe(1);
    expect(agent?.currentTask).toMatch(/Fix checkout regression/);
  });

  it("parseModelUsage normalizes haiku 4.5, truncates long model ids, and reads subagent jsonl", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b16-${crypto.randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${crypto.randomUUID().slice(0, 6)}`);
    const sessionDir = path.join(projectDir, `session-${crypto.randomUUID().slice(0, 6)}`);
    const subagentsDir = path.join(sessionDir, "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });

    const subJsonl = path.join(subagentsDir, "agent.jsonl");
    fs.writeFileSync(
      subJsonl,
      [
        JSON.stringify({
          type: "assistant",
          requestId: "sub-req-1",
          timestamp: "2026-06-02T00:00:00.000Z",
          message: {
            model: "claude-haiku-4-5-preview-extra-long-name-should-truncate",
            usage: { input_tokens: 4, output_tokens: 2 },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const staleJsonl = path.join(projectDir, "stale.jsonl");
    fs.writeFileSync(staleJsonl, "{ not json\n", "utf8");
    const oldMtime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(staleJsonl, oldMtime, oldMtime);

    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-06-01T00:00:00.000Z"));
    expect(usage.models.some((m) => m.name === "Haiku 4.5")).toBe(true);
    expect(usage.total.requests).toBeGreaterThanOrEqual(1);
  });
});
