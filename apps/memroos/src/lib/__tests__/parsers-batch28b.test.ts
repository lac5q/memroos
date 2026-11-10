// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseAgents } from "@/lib/parsers";

describe("parsers batch28b — status markers, platform detection, missing root", () => {
  afterEach(() => {
    // temp dirs cleaned in finally blocks
  });

  it("parseAgents returns empty array when configs root is missing", async () => {
    const missing = path.join(os.tmpdir(), `missing-agents-b28b-${randomUUID()}`);
    const agents = await parseAgents(missing);
    expect(agents).toEqual([]);
  });

  it("detectStatus marks agents error when heartbeat contains explicit ERROR marker", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b28b-${randomUUID()}-`));
    const agentDir = path.join(root, "codex-worker-b28b");
    fs.mkdirSync(agentDir, { recursive: true });
    const hbPath = path.join(agentDir, "HEARTBEAT.md");
    fs.writeFileSync(hbPath, "STATUS: error — batch28b marker\n", "utf8");
    const recent = new Date();
    fs.utimesSync(hbPath, recent, recent);
    try {
      const agents = await parseAgents(root);
      expect(agents[0]?.platform).toBe("codex");
      expect(agents[0]?.status).toBe("error");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("parseAgents prefers PopSmiths company over OpenClaw platform mention", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `company-b28b-${randomUUID()}-`));
    const agentDir = path.join(root, "openclaw-ops-b28b");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# hb\n", "utf8");
    fs.writeFileSync(
      path.join(agentDir, "SOUL.md"),
      "Serving PopSmiths while running on OpenClaw infrastructure.\n",
      "utf8",
    );
    try {
      const agents = await parseAgents(root);
      expect(agents[0]?.company).toBe("PopSmiths");
      expect(agents[0]?.platform).toBe("openclaw");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
