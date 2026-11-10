// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("parsers batch29 — parseModelUsage stream throw + parseAgents skip", () => {
  const origHome = process.env.HOME;
  let testHome: string;

  beforeEach(() => {
    testHome = path.join(os.tmpdir(), `parsers-b29-${randomUUID()}`);
    fs.mkdirSync(testHome, { recursive: true });
    process.env.HOME = testHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(testHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("skips non-directory entries in parseAgents (line 69)", async () => {
    const configs = path.join(testHome, `agents-b29-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(configs, { recursive: true });
    fs.writeFileSync(path.join(configs, "file-not-dir.txt"), "noop", "utf8");
    const agentDir = path.join(configs, "agent-b29");
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# ok\n", "utf8");
    const { parseAgents } = await import("../parsers");
    const agents = await parseAgents(configs);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe("agent-b29");
  });

  it("aggregateRecentJsonlFile skips jsonl older than since (line 426 path)", async () => {
    const project = path.join(testHome, ".claude", "projects", `proj-b29-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(project, { recursive: true });
    const oldFile = path.join(project, "stale-b29.jsonl");
    const past = "2019-01-01T00:00:00.000Z";
    fs.writeFileSync(
      oldFile,
      `${JSON.stringify({
        type: "assistant",
        timestamp: past,
        message: { model: "model-stale-b29", usage: { input_tokens: 9, output_tokens: 1 } },
      })}\n`,
      "utf8",
    );
    const oldStat = new Date("2018-06-01T00:00:00.000Z");
    fs.utimesSync(oldFile, oldStat, oldStat);
    const { parseModelUsage } = await import("../parsers");
    const usage = await parseModelUsage(new Date("2026-01-01T00:00:00.000Z"));
    expect(usage.models.find((m) => m.id === "model-stale-b29")).toBeUndefined();
  });

  it("createReadStream throw short-circuits aggregateJsonlFile (lines 361–365)", async () => {
    vi.doMock("fs", async () => {
      const actual = await vi.importActual<typeof import("fs")>("fs");
      return {
        ...actual,
        createReadStream: () => {
          throw new Error("batch29-simulated-stream-failure");
        },
      };
    });
    vi.resetModules();
    const { parseModelUsage } = await import("../parsers");
    const project = path.join(testHome, ".claude", "projects", `stream-b29-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "bad-b29.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        message: { model: "should-not-count", usage: { input_tokens: 1, output_tokens: 1 } },
      })}\n`,
      "utf8",
    );
    const usage = await parseModelUsage();
    expect(usage.models.find((m) => m.id === "should-not-count")).toBeUndefined();
    vi.doUnmock("fs");
    vi.resetModules();
  });

  it("skips empty jsonl lines in aggregateJsonlFile (line 369)", async () => {
    const project = path.join(testHome, ".claude", "projects", `empty-lines-b29-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "mix-b29.jsonl"),
      [
        "",
        JSON.stringify({
          type: "assistant",
          message: { model: "after-empty-b29", usage: { input_tokens: 2, output_tokens: 1 } },
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    const { parseModelUsage } = await import("../parsers");
    const usage = await parseModelUsage();
    expect(usage.models.some((m) => m.id === "after-empty-b29")).toBe(true);
  });
});
