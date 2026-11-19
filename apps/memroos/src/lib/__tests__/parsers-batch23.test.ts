// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch23 — agent dirs and jsonl aggregation edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parseAgents skips non-directory entries under configs path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b23-${randomUUID()}-`));
    fs.writeFileSync(path.join(root, "not-a-dir.txt"), "x", "utf8");
    const agents = await parseAgents(root);
    expect(agents).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseModelUsage skips assistant rows older than since and missing usage", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b23-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    const projectDir = path.join(home, ".claude", "projects", "proj-b23");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "session.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2025-01-01T00:00:00.000Z",
          message: { model: "old-model", usage: { input_tokens: 9, output_tokens: 1 } },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-10-30T00:00:00.000Z",
          message: { model: "no-usage-model" },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-10-30T00:00:01.000Z",
          requestId: "req-b23",
          message: {
            model: "claude-b23",
            usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 4 },
          },
        }),
      ].join("\n"),
      "utf8",
    );
    try {
      const usage = await parseModelUsage(new Date("2026-10-01T00:00:00.000Z"));
      const model = usage.models.find((m) => m.id === "claude-b23");
      expect(model?.requests).toBe(1);
      expect(model?.inputTokens).toBe(7);
      expect(model?.cacheRead).toBe(1);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("parseModelUsage ignores jsonl files older than since via mtime gate", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-mtime-b23-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    const projectDir = path.join(home, ".claude", "projects", "proj-mtime");
    fs.mkdirSync(projectDir, { recursive: true });
    const staleFile = path.join(projectDir, "stale.jsonl");
    fs.writeFileSync(
      staleFile,
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-30T00:00:00.000Z",
        message: { model: "stale-model", usage: { input_tokens: 1, output_tokens: 1 } },
      }),
      "utf8",
    );
    const old = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(staleFile, old, old);
    try {
      const usage = await parseModelUsage(new Date("2026-10-01T00:00:00.000Z"));
      expect(usage.models.find((m) => m.id === "stale-model")).toBeUndefined();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
