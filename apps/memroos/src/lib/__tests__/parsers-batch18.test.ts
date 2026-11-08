// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch18 — agent dirs and model name edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parseAgents ignores non-directory entries in the configs folder", async () => {
    const configs = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b18-${randomUUID()}-`));
    fs.writeFileSync(path.join(configs, "not-a-dir.txt"), "noop", "utf8");
    const agents = await parseAgents(configs);
    expect(agents).toEqual([]);
  });

  it("parseModelUsage maps long unknown model ids to a 20 character display name", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b18-${randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const longModel = "provider-model-name-that-is-very-long-indeed";
    fs.writeFileSync(
      path.join(projectDir, "long-model.jsonl"),
      JSON.stringify({
        type: "assistant",
        requestId: "req-long-model",
        timestamp: "2026-07-10T00:00:00.000Z",
        message: { model: longModel, usage: { input_tokens: 3, output_tokens: 1 } },
      }),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    const stat = usage.models.find((model) => model.id === longModel);
    expect(stat?.name).toBe(longModel.slice(0, 20));
  });

  it("parseModelUsage skips jsonl files older than the since timestamp", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b18b-${randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const stalePath = path.join(projectDir, "stale.jsonl");
    fs.writeFileSync(
      stalePath,
      JSON.stringify({
        type: "assistant",
        requestId: "req-stale",
        timestamp: "2020-01-01T00:00:00.000Z",
        message: { model: "claude-haiku-4-5", usage: { input_tokens: 9, output_tokens: 1 } },
      }),
      "utf8",
    );
    const staleDate = new Date("2019-06-01T00:00:00.000Z");
    fs.utimesSync(stalePath, staleDate, staleDate);
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.total.requests).toBe(0);
  });

  it("parseModelUsage normalizes Haiku 4.5 model ids", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b18c-${randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "haiku.jsonl"),
      JSON.stringify({
        type: "assistant",
        requestId: "req-haiku",
        timestamp: "2026-07-10T00:00:00.000Z",
        message: { model: "claude-haiku-4-5-preview", usage: { input_tokens: 2, output_tokens: 2 } },
      }),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.models.some((model) => model.name === "Haiku 4.5")).toBe(true);
  });
});
