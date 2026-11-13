// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { createDefaultMiddlewareFiles, runToolWithMiddleware } from "../middleware";

describe("agent-runtime middleware batch36 — homeHermesRoot (35)", () => {
  const homeSnapshot = process.env.HOME;
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-b36-${randomUUID()}-`));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    process.env.HOME = homeSnapshot;
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("createDefaultMiddlewareFiles without hermesRoot uses HOME/.hermes", () => {
    createDefaultMiddlewareFiles();
    const configPath = path.join(homeDir, ".hermes", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("runToolWithMiddleware defaults hermesRoot to HOME/.hermes", async () => {
    const result = await runToolWithMiddleware({
      toolName: "batch36-demo",
      input: { ok: true },
      execute: async () => ({ ok: true }),
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(homeDir, ".hermes", "middleware", "pre"))).toBe(true);
  });
});
