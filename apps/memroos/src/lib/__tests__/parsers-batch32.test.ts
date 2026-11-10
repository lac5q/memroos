// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parsers batch32 — agent state catch and requestId dedupe", () => {
  it("parseAgents tolerates missing HEARTBEAT_STATE.md", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `parsers-agents-b32-${crypto.randomUUID()}-`));
    const agentDir = path.join(root, `agent-b32-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# batch32\n", "utf8");
    const agents = await parseAgents(root);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.currentTask).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseAgents reads first heading as currentTask when state file exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `parsers-state-b32-${crypto.randomUUID()}-`));
    const agentDir = path.join(root, `agent-state-b32-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT_STATE.md"), "## Ship batch32\n", "utf8");
    const agents = await parseAgents(root);
    expect(agents[0]?.currentTask).toBe("Ship batch32");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseModelUsage dedupes assistant rows by requestId", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b32-${crypto.randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${crypto.randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const jsonl = path.join(projectDir, "dup.jsonl");
    fs.writeFileSync(
      jsonl,
      [
        JSON.stringify({
          type: "assistant",
          requestId: "dup-req-b32",
          timestamp: "2026-07-10T00:00:00.000Z",
          message: { model: "claude-haiku-4-5", usage: { input_tokens: 5, output_tokens: 1 } },
        }),
        JSON.stringify({
          type: "assistant",
          requestId: "dup-req-b32",
          timestamp: "2026-07-10T00:00:01.000Z",
          message: { model: "claude-haiku-4-5", usage: { input_tokens: 99, output_tokens: 99 } },
        }),
      ].join("\n"),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.total.requests).toBe(1);
    expect(usage.total.inputTokens).toBe(5);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
