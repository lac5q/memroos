// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

const LOOPBACK = "http://localhost";
const APO_PROPOSAL = "APO_PROPOSAL_demo_skill_demo_20260505_120000.md";
const APO_BODY = `# Proposal
**APO Constraint to add to SKILL.md:**
\`\`\`
Always validate auth before retry.
\`\`\`
`;

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadApoRoute(apoRoot: string) {
  vi.resetModules();
  vi.stubEnv("APO_PROPOSALS_PATH", path.join(apoRoot, "proposals"));
  vi.stubEnv("APO_SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("APO_AGENT_CONFIGS_PATH", path.join(apoRoot, "agents"));
  vi.stubEnv("APO_CRON_LOG_PATH", path.join(apoRoot, "cron.log"));
  vi.stubEnv("SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("HOME", apoRoot);
  for (const segment of [
    "github/PMO/agents",
    "github/knowledge/agent-configs",
    "github/knowledge/skills",
    ".openclaw/skills",
    ".claude/skills",
  ]) {
    mkdirSync(path.join(apoRoot, segment), { recursive: true });
  }
  return import("../apo/route");
}

describe("batch14 — /api/apo extended paths", () => {
  let apoRoot: string;

  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    apoRoot = mkdtempSync(path.join(tmpdir(), `apo-batch14-${randomUUID()}-`));
  });

  afterEach(() => {
    rmSync(apoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("POST approve rejects invalid proposal ids", async () => {
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "approve", proposalId: "../evil.md" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Invalid proposal id" });
  });

  it("POST apply-approved resolves agent AGENTS.md targets and archives work items", async () => {
    const agentId = "demo-agent";
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    mkdirSync(path.join(apoRoot, "agents", agentId), { recursive: true });
    const agentProposal = `APO_PROPOSAL_${agentId}_demo_20260505_120000.md`;
    writeFileSync(path.join(apoRoot, "proposals", "approved", agentProposal), APO_BODY);
    writeFileSync(path.join(apoRoot, "agents", agentId, "AGENTS.md"), "# Agent\n");
    writeFileSync(
      path.join(apoRoot, "proposals", "approved", `${agentProposal}.json`),
      JSON.stringify({
        proposalId: agentProposal,
        skillId: agentId,
        targetPath: path.join(apoRoot, "agents", agentId, "AGENTS.md"),
        targetKind: "agent",
        executorCli: "qwen",
        status: "approved",
        approvedAt: new Date().toISOString(),
      })
    );
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: agentProposal, executorCli: "codex" })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.targetKind).toBe("agent");
    expect(body.applied).toBe(true);
  });

  it("POST apply-approved returns 404 when target cannot be resolved", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), APO_BODY);
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: APO_PROPOSAL })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("GET lists archived proposals with implemented tracking metadata", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "archived"), { recursive: true });
    mkdirSync(path.join(apoRoot, "skills", "demo"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "archived", APO_PROPOSAL), APO_BODY);
    writeFileSync(
      path.join(apoRoot, "proposals", "archived", `${APO_PROPOSAL}.json`),
      JSON.stringify({
        proposalId: APO_PROPOSAL,
        skillId: "demo",
        targetPath: path.join(apoRoot, "skills", "demo", "SKILL.md"),
        targetKind: "skill",
        executorCli: "qwen",
        status: "implemented",
        approvedAt: "2026-01-01T00:00:00.000Z",
        implementedAt: "2026-01-02T00:00:00.000Z",
        archivedAt: "2026-01-02T00:00:00.000Z",
        applied: false,
      })
    );
    const { GET } = await loadApoRoute(apoRoot);
    const body = await (await GET()).json();
    const archived = body.proposals.find((p: { status: string }) => p.status === "archived");
    expect(archived?.tracking?.label).toBe("Archived");
    expect(archived?.tracking?.applied).toBe(false);
  });

  it("GET approved queue exposes queued worker tracking", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), APO_BODY);
    writeFileSync(
      path.join(apoRoot, "proposals", "approved", `${APO_PROPOSAL}.json`),
      JSON.stringify({
        proposalId: APO_PROPOSAL,
        skillId: "demo",
        targetPath: path.join(apoRoot, "skills", "demo", "SKILL.md"),
        targetKind: "skill",
        executorCli: "custom-cli",
        status: "approved",
        approvedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    const { GET } = await loadApoRoute(apoRoot);
    const body = await (await GET()).json();
    const approved = body.proposals.find((p: { status: string }) => p.status === "approved");
    expect(approved?.tracking?.phase).toBe("queued");
    expect(approved?.tracking?.executorCli).toBe("custom-cli");
  });

  it("POST apply-approved rejects invalid proposal ids", async () => {
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: "not-valid.md" })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "Invalid proposal id" });
  });

  it("POST process-approved succeeds on an empty approved queue", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "process-approved", limit: 5 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
  });
});
