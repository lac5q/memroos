// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { parseAgents } from "@/lib/parsers";

describe("parsers batch25b — heartbeat error markers and missing roots", () => {
  it("parseAgents returns empty array when configs path is missing", async () => {
    const missing = path.join(os.tmpdir(), `missing-agents-b25b-${randomUUID()}`);
    const agents = await parseAgents(missing);
    expect(agents).toEqual([]);
  });

  it("parseAgents marks agents error when heartbeat contains explicit error markers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-err-b25b-${randomUUID()}-`));
    const agentDir = path.join(root, "agent-err-b25b");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "STATUS: error — blocked batch25b\n", "utf8");
    try {
      const agents = await parseAgents(root);
      expect(agents).toHaveLength(1);
      expect(agents[0]?.status).toBe("error");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
