// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseModelUsage } from "@/lib/parsers";

describe("parsers batch19", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parseModelUsage normalizes generic Opus model ids", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b19-${randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "opus.jsonl"),
      JSON.stringify({
        type: "assistant",
        requestId: "req-opus",
        timestamp: "2026-07-10T00:00:00.000Z",
        message: { model: "claude-opus-legacy-id", usage: { input_tokens: 4, output_tokens: 2 } },
      }),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.models[0]?.name).toBe("Opus");
  });

  it("parseModelUsage skips unreadable jsonl files without crashing", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b19b-${randomUUID()}-`));
    const projectDir = path.join(home, ".claude", "projects", `proj-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(projectDir, { recursive: true });
    const unreadable = path.join(projectDir, "unreadable.jsonl");
    fs.writeFileSync(unreadable, "{}", "utf8");
    fs.chmodSync(unreadable, 0o000);
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.total.requests).toBe(0);
    fs.chmodSync(unreadable, 0o600);
  });

  it("parseModelUsage ignores non-directory project entries under .claude/projects", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `parser-home-b19c-${randomUUID()}-`));
    const projectsDir = path.join(home, ".claude", "projects");
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(path.join(projectsDir, "not-a-project.txt"), "noop", "utf8");
    vi.stubEnv("HOME", home);
    const usage = await parseModelUsage(new Date("2026-07-01T00:00:00.000Z"));
    expect(usage.total.requests).toBe(0);
  });
});
