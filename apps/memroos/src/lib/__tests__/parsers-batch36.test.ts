// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { parseAgents } from "@/lib/parsers";

describe("parsers batch36 — stat catch (69)", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("parseAgents skips entries when stat fails (broken symlink)", async () => {
    const configs = fs.mkdtempSync(path.join(os.tmpdir(), `agents-b36-${randomUUID()}-`));
    roots.push(configs);
    const agentDir = path.join(configs, "agent-b36-ok");
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "# heartbeat\n", "utf8");
    const broken = path.join(configs, "agent-b36-broken");
    try {
      fs.symlinkSync(path.join(configs, "missing-target-b36"), broken);
    } catch {
      fs.writeFileSync(path.join(configs, "agent-b36-file-not-dir"), "x", "utf8");
    }

    const agents = await parseAgents(configs);
    expect(agents.some((a) => a.id === "agent-b36-ok")).toBe(true);
    expect(agents.every((a) => a.id !== "agent-b36-broken")).toBe(true);
  });
});
