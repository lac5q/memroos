// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch28c — non-directory entries and jsonl open failures", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    vi.restoreAllMocks();
  });

  it("parseAgents skips files at the configs root (line 69-70)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b28c-${randomUUID()}-`));
    roots.push(root);
    fs.writeFileSync(path.join(root, "not-a-directory.txt"), "plain file batch28c\n", "utf8");
    const agentDir = path.join(root, "codex-worker-b28c");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# hb\n", "utf8");
    const agents = await parseAgents(root);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.platform).toBe("codex");
  });

  it("parseModelUsage skips stale jsonl files when since is newer than mtime (lines 425-427)", async () => {
    const home = process.env.HOME ?? os.tmpdir();
    const projectsDir = path.join(home, ".claude", "projects", `proj-b28c-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectsDir, { recursive: true });
    roots.push(projectsDir);
    const jsonlPath = path.join(projectsDir, "stale-batch28c.jsonl");
    fs.writeFileSync(
      jsonlPath,
      `${JSON.stringify({ type: "assistant", message: { model: "claude-stale-b28c", usage: { input_tokens: 1, output_tokens: 2 } } })}\n`,
      "utf8",
    );
    const stale = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(jsonlPath, stale, stale);

    const usage = await parseModelUsage(new Date("2030-01-01T00:00:00.000Z"));
    expect(usage.models.find((m) => m.id === "claude-stale-b28c")).toBeUndefined();
  });
});
