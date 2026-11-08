// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { parseAgents, parseModelUsage } from "../parsers";

const TMP = path.join(os.tmpdir(), `parsers-b31-${randomUUID()}`);

afterEach(() => {
  delete process.env.HOME;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("parsers batch31 — parseAgents dir guard + parseModelUsage mtime (L69, L426)", () => {
  it("parseAgents skips entries that are not directories (L69)", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, "readme-batch31.txt"), "not a dir", "utf8");
    const agentDir = path.join(TMP, `agent-b31-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# batch31\n", "utf8");
    const agents = await parseAgents(TMP);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(path.basename(agentDir));
  });

  it("parseModelUsage skips jsonl older than since (L426)", async () => {
    const home = path.join(TMP, "home");
    const project = path.join(home, ".claude", "projects", `proj-b31-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(project, { recursive: true });
    const oldFile = path.join(project, "stale-b31.jsonl");
    fs.writeFileSync(oldFile, '{"type":"assistant","timestamp":"2020-01-01T00:00:00.000Z"}\n', "utf8");
    const oldDate = new Date("2019-06-01T00:00:00.000Z");
    fs.utimesSync(oldFile, oldDate, oldDate);
    process.env.HOME = home;
    const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
    expect(usage.models).toEqual([]);
  });
});
