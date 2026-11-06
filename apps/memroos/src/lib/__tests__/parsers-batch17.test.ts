// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseModelUsage } from "@/lib/parsers";

describe("parsers batch17 — model normalization and jsonl aggregation edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parseAgents returns empty list when configs path is missing", async () => {
    const missing = path.join(os.tmpdir(), `missing-agents-${crypto.randomUUID()}`);
    await expect(parseAgents(missing)).resolves.toEqual([]);
  });

  it("parseModelUsage normalizes Sonnet 4.6 and Opus 4.5 model ids", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b17-${crypto.randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${crypto.randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const jsonl = path.join(projectDir, "usage.jsonl");
    fs.writeFileSync(
      jsonl,
      [
        JSON.stringify({
          type: "assistant",
          requestId: "req-sonnet",
          timestamp: "2026-07-10T00:00:00.000Z",
          message: { model: "claude-sonnet-4-6-preview", usage: { input_tokens: 1, output_tokens: 1 } },
        }),
        JSON.stringify({
          type: "assistant",
          requestId: "req-opus",
          timestamp: "2026-07-10T00:00:01.000Z",
          message: { model: "claude-opus-4-5-preview", usage: { input_tokens: 2, output_tokens: 2 } },
        }),
      ].join("\n"),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.models.some((m) => m.name === "Sonnet 4.6")).toBe(true);
    expect(usage.models.some((m) => m.name === "Opus 4.5")).toBe(true);
  });

  it("parseModelUsage deduplicates duplicate requestId lines in one jsonl file", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b17b-${crypto.randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${crypto.randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const jsonl = path.join(projectDir, "dup.jsonl");
    fs.writeFileSync(
      jsonl,
      [
        JSON.stringify({
          type: "assistant",
          requestId: "dup-req",
          timestamp: "2026-07-10T00:00:00.000Z",
          message: { model: "claude-haiku-4-5", usage: { input_tokens: 5, output_tokens: 1 } },
        }),
        JSON.stringify({
          type: "assistant",
          requestId: "dup-req",
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
  });
});
