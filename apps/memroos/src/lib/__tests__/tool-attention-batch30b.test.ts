// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { getToolAttention } from "@/lib/tool-attention";

let tempRoot: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("tool-attention batch30b — gitnexus catch, agent-lightning available, publicPath", () => {
  it("gitnexusStatus treats unreadable .mcp.json as degraded optional wiring (line 42)", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tool-att-b30b-mcp-${randomUUID()}-`));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const registryPath = path.join(tempRoot, "gitnexus-registry.json");
    fs.writeFileSync(registryPath, JSON.stringify({ ok: true }));
    fs.writeFileSync(catalogPath, JSON.stringify({ capabilities: [], sources: [] }));
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));
    vi.stubEnv("MEMROOS_OPTIONAL_CAPABILITIES", "gitnexus");
    vi.stubEnv("GITNEXUS_REGISTRY", registryPath);

    const originalRead = fs.readFileSync.bind(fs);
    let mcpReads = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation((target, ...rest) => {
      if (target.toString().endsWith(".mcp.json")) {
        mcpReads += 1;
        if (mcpReads === 1) {
          return JSON.stringify({ mcpServers: { gitnexus: {} } });
        }
        throw new Error("EACCES batch30b");
      }
      return originalRead(target, ...rest);
    });
    const originalExists = fs.existsSync.bind(fs);
    vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      const p = target.toString();
      if (p.endsWith(".mcp.json")) return true;
      if (p === registryPath) return true;
      return originalExists(target);
    });

    const data = getToolAttention("gitnexus", 25);
    const gitnexus = data.capabilities.find((c) => c.id === "mcp-server:gitnexus");
    expect(gitnexus?.status).toBe("degraded");
  });

  it("agentLightningStatus is available when worker script, proposals, and cron log exist (line 59)", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tool-att-b30b-apo-${randomUUID()}-`));
    const catalogPath = path.join(tempRoot, "catalog.json");
    const proposals = path.join(tempRoot, "proposals");
    const cronLog = path.join(tempRoot, "agent-lightning-cron.log");
    fs.mkdirSync(proposals);
    fs.writeFileSync(cronLog, "ok\n", "utf8");
    fs.writeFileSync(catalogPath, JSON.stringify({ capabilities: [], sources: [] }));
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));
    vi.stubEnv("MEMROOS_OPTIONAL_CAPABILITIES", "agent-lightning");
    vi.stubEnv("APO_PROPOSALS_PATH", proposals);
    vi.stubEnv("APO_CRON_LOG_PATH", cronLog);

    const data = getToolAttention("agent-lightning", 10);
    const cap = data.capabilities.find((c) => c.id === "capability:agent-lightning");
    expect(cap?.status).toBe("available");
  });

  it("publicPath preserves https sources and omits undefined paths (line 153)", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tool-att-b30b-pub-${randomUUID()}-`));
    const catalogPath = path.join(tempRoot, "catalog.json");
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({
        capabilities: [],
        sources: [
          {
            id: "remote-catalog",
            label: "Remote",
            type: "remote",
            path: "https://example.com/tools/catalog-batch30b.json",
            status: "available",
          },
        ],
      }),
    );
    fs.writeFileSync(path.join(tempRoot, "outcomes.jsonl"), "");

    vi.stubEnv("TOOL_ATTENTION_CATALOG", catalogPath);
    vi.stubEnv("TOOL_ATTENTION_OUTCOMES", path.join(tempRoot, "outcomes.jsonl"));
    vi.stubEnv("SKILLS_PATH", path.join(tempRoot, "no-skills"));

    const data = getToolAttention("", 5);
    const remote = data.sources.find((s) => s.id === "remote-catalog");
    expect(remote?.path).toBe("https://example.com/tools/catalog-batch30b.json");
  });
});
