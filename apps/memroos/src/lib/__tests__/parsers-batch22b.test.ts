// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseModelUsage } from "@/lib/parsers";

describe("parsers batch22b — jsonl stream edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parseModelUsage skips unreadable jsonl files and dedupes requestId", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b22b-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    const projectsRoot = path.join(home, ".claude", "projects");
    const projectDir = path.join(projectsRoot, "proj-b22b");
    fs.mkdirSync(projectDir, { recursive: true });
    const missing = path.join(projectDir, "missing.jsonl");
    const good = path.join(projectDir, "session.jsonl");
    fs.writeFileSync(
      good,
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-08-01T00:00:00.000Z",
          requestId: "req-dup",
          message: { model: "claude-b22b", usage: { input_tokens: 4, output_tokens: 2 } },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-08-01T00:00:01.000Z",
          requestId: "req-dup",
          message: { model: "claude-b22b", usage: { input_tokens: 99, output_tokens: 99 } },
        }),
        "{bad json",
      ].join("\n"),
      "utf8",
    );
    try {
      const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
      const model = usage.models.find((m) => m.id === "claude-b22b");
      expect(model?.requests).toBe(1);
      expect(model?.inputTokens).toBe(4);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
