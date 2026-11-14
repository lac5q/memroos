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
const APO_PROPOSAL = "APO_PROPOSAL_opsagent_ops_20260505_120000.md";
const APO_BODY = `# Proposal
**APO Constraint to add to SKILL.md:**
\`\`\`
Validate retries with auth context.
\`\`\`
`;

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadApoRoute(apoRoot: string, extraEnv: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv("APO_PROPOSALS_PATH", path.join(apoRoot, "proposals"));
  vi.stubEnv("APO_SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("APO_AGENT_CONFIGS_PATH", path.join(apoRoot, "agents"));
  vi.stubEnv("APO_CRON_LOG_PATH", path.join(apoRoot, "cron.log"));
  vi.stubEnv("SKILLS_PATH", extraEnv.SKILLS_PATH);
  vi.stubEnv("HOME", apoRoot);
  for (const segment of ["github/PMO/agents", "github/knowledge/agent-configs", "github/knowledge/skills", ".openclaw/skills", ".claude/skills"]) {
    mkdirSync(path.join(apoRoot, segment), { recursive: true });
  }
  return import("../apo/route");
}

describe("apo route batch34b — env fallbacks and queue paths", () => {
  let apoRoot: string;

  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    apoRoot = mkdtempSync(path.join(tmpdir(), `apo-batch34b-${randomUUID()}-`));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(apoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("GET derives lastRun from cron log timestamps (line 470)", async () => {
    mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
    writeFileSync(
      path.join(apoRoot, "cron.log"),
      ["noise", "[CRON] APO cycle 2026-05-05T12:34"].join("\n"),
      "utf8",
    );
    const { GET } = await loadApoRoute(apoRoot);
    const res = await GET();
    const body = await res.json();
    expect(body.stats.lastRun).toBe("2026-05-05T12:34");
  });

  it("GET parses proposal filenames without regex groups (lines 57–58)", async () => {
    mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "plain_proposal.md"), APO_BODY, "utf8");
    const { GET } = await loadApoRoute(apoRoot);
    const body = await (await GET()).json();
    expect(body.proposals[0]?.skill).toBe("plain_proposal.md");
    expect(body.proposals[0]?.subsystem).toBe("unknown");
  });

  it("approve resolves agent AGENTS.md via agentRoots (line 158)", async () => {
    mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", APO_PROPOSAL), APO_BODY, "utf8");
    const agentDir = path.join(apoRoot, "github", "PMO", "agents", "opsagent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, "AGENTS.md"), "# Agent\n", "utf8");

    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, {
        action: "approve",
        proposalId: APO_PROPOSAL,
        executorCli: "   ",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetKind).toBe("agent");
    expect(body.executorCli).toBe("qwen");
  });

  it("apply-approved uses queued target when work-item JSON exists (lines 301–306)", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    mkdirSync(path.join(apoRoot, "proposals", "archived"), { recursive: true });
    const skillDir = path.join(apoRoot, "skills", "demo_skill");
    mkdirSync(skillDir, { recursive: true });
    const targetPath = path.join(skillDir, "SKILL.md");
    writeFileSync(targetPath, "# Skill\n", "utf8");
    writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), APO_BODY, "utf8");
    writeFileSync(
      path.join(apoRoot, "proposals", "approved", `${APO_PROPOSAL}.json`),
      JSON.stringify({
        proposalId: APO_PROPOSAL,
        skillId: "demo_skill",
        targetPath,
        targetKind: "skill",
        executorCli: "qwen",
        status: "approved",
        approvedAt: new Date().toISOString(),
      }),
    );

    const { POST } = await loadApoRoute(apoRoot, { SKILLS_PATH: path.join(apoRoot, "skills") });
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: APO_PROPOSAL }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(String(body.targetPath)).toContain("SKILL.md");
  });

  it("process-approved honors numeric limit argument (line 537)", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), APO_BODY, "utf8");
  writeFileSync(
      path.join(apoRoot, "proposals", "approved", `${APO_PROPOSAL}.json`),
      JSON.stringify({
        proposalId: APO_PROPOSAL,
        skillId: "demo_skill",
        targetPath: path.join(apoRoot, "skills", "demo_skill", "SKILL.md"),
        targetKind: "skill",
        executorCli: "qwen",
        status: "approved",
        approvedAt: new Date().toISOString(),
      }),
    );

    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "process-approved", limit: 0 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });
});
