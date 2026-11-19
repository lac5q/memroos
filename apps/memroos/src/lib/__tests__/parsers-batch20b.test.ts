// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAgents, parseTokenStats } from "@/lib/parsers";

describe("parsers batch20b", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parseAgents detects platform, company priority, and error heartbeat status", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b20b-${randomUUID()}-`));
    const agentDir = path.join(root, "codex-worker-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "STATUS: error\nblocked task", "utf8");
    fs.writeFileSync(path.join(agentDir, "SOUL.md"), "Serving PopSmiths growth ops.", "utf8");
    const agents = await parseAgents(root);
    expect(agents[0]?.platform).toBe("codex");
    expect(agents[0]?.company).toBe("PopSmiths");
    expect(agents[0]?.status).toBe("error");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parseAgents returns empty list when configs path is missing", async () => {
    const missing = path.join(os.tmpdir(), `missing-agents-${randomUUID()}`);
    await expect(parseAgents(missing)).resolves.toEqual([]);
  });

  it("parseTokenStats returns null when claude stats file is absent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b20b-${randomUUID()}-`));
    vi.stubEnv("HOME", home);
    expect(parseTokenStats()).toBeNull();
    fs.rmSync(home, { recursive: true, force: true });
  });
});
