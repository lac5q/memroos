// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import { parseModelUsage } from "@/lib/parsers";

describe("parsers batch15 — model normalization and jsonl aggregation", () => {
  it("parseModelUsage aggregates assistant jsonl entries and normalizes model names", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b15-${crypto.randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `demo-proj-${crypto.randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const jsonl = path.join(projectDir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "assistant",
        requestId: "req-1",
        timestamp: "2026-06-01T00:00:00.000Z",
        message: {
          model: "claude-opus-4-6-preview",
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        requestId: "req-1",
        timestamp: "2026-06-01T00:00:01.000Z",
        message: {
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      }),
      JSON.stringify({ type: "user", message: { model: "ignored" } }),
      "{ malformed json",
    ];
    fs.writeFileSync(jsonl, `${lines.join("\n")}\n`, "utf8");

    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-05-31T00:00:00.000Z"));
    expect(usage.models.length).toBeGreaterThan(0);
    expect(usage.models.some((m) => /Opus|Sonnet|Haiku/.test(m.name))).toBe(true);
    expect(usage.total.requests).toBeGreaterThanOrEqual(1);
    vi.unstubAllEnvs();
  });
});
