// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseModelUsage } from "@/lib/parsers";

describe("parsers batch21 — model usage aggregation edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parseModelUsage skips unreadable project directories under ~/.claude/projects", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b21-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    const projectsRoot = path.join(home, ".claude", "projects");
    fs.mkdirSync(projectsRoot, { recursive: true });
    const blocked = path.join(projectsRoot, "blocked-project");
    fs.mkdirSync(blocked, { recursive: true });
    fs.chmodSync(blocked, 0o000);
    const open = path.join(projectsRoot, "open-project");
    fs.mkdirSync(open, { recursive: true });
    fs.writeFileSync(
      path.join(open, "session.jsonl"),
      `${JSON.stringify({
        type: "assistant",
        timestamp: "2026-07-01T00:00:00.000Z",
        message: { model: "claude-test", usage: { input_tokens: 3, output_tokens: 2 } },
      })}\n`,
      "utf8",
    );
    try {
      const usage = await parseModelUsage();
      expect(usage.models.some((m) => m.id === "claude-test")).toBe(true);
    } finally {
      fs.chmodSync(blocked, 0o755);
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("parseModelUsage returns empty totals when HOME has no Claude projects", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b21-empty-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    try {
      const usage = await parseModelUsage();
      expect(usage.total.requests).toBe(0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
