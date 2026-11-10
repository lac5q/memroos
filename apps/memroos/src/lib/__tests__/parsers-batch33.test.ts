// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { parseAgents, parseModelUsage } from "../parsers";

const TMP = path.join(os.tmpdir(), `parsers-b33-${randomUUID()}`);

afterEach(() => {
  delete process.env.HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("parsers batch33", () => {
  it("parseAgents skips non-directory entries (69)", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, `file-b33-${randomUUID().slice(0, 6)}.txt`), "not a dir", "utf8");
    const agentDir = path.join(TMP, `agent-b33-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# batch33\n", "utf8");
    const agents = await parseAgents(TMP);
    expect(agents).toHaveLength(1);
  });

  it("parseModelUsage skips jsonl older than since (426)", async () => {
    const home = path.join(TMP, "home");
    const project = path.join(home, ".claude", "projects", `proj-b33-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(project, { recursive: true });
    const oldFile = path.join(project, "stale-b33.jsonl");
    fs.writeFileSync(oldFile, '{"type":"assistant","timestamp":"2020-01-01T00:00:00.000Z"}\n', "utf8");
    const oldDate = new Date("2019-06-01T00:00:00.000Z");
    fs.utimesSync(oldFile, oldDate, oldDate);
    process.env.HOME = home;
    const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
    expect(usage.models).toEqual([]);
  });
});
