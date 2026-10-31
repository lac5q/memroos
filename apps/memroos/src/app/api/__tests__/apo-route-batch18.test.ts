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

async function loadApoRoute(apoRoot: string) {
  vi.resetModules();
  vi.stubEnv("APO_PROPOSALS_PATH", path.join(apoRoot, "proposals"));
  vi.stubEnv("APO_SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("APO_AGENT_CONFIGS_PATH", path.join(apoRoot, "agents"));
  vi.stubEnv("APO_CRON_LOG_PATH", path.join(apoRoot, "cron.log"));
  vi.stubEnv("SKILLS_PATH", path.join(apoRoot, "skills"));
  vi.stubEnv("HOME", apoRoot);
  for (const segment of ["github/PMO/agents", "github/knowledge/agent-configs", "github/knowledge/skills", ".openclaw/skills", ".claude/skills"]) {
    mkdirSync(path.join(apoRoot, segment), { recursive: true });
  }
  return import("../apo/route");
}

describe("apo route batch18 — filesystem error branches", () => {
  let apoRoot: string;

  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    apoRoot = mkdtempSync(path.join(tmpdir(), `apo-batch18-${randomUUID()}-`));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(apoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.doUnmock("fs/promises");
    vi.resetModules();
  });

  it("resolveApprovalTarget propagates non-ENOENT read errors", async () => {
    vi.doMock("fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("fs/promises")>();
      return {
        ...actual,
        readFile: vi.fn(async (filePath: string, encoding?: unknown) => {
          if (String(filePath).includes("SKILL.md")) {
            const err = new Error("EACCES") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          }
          return actual.readFile(filePath, encoding as never);
        }),
      };
    });
    const skillDir = path.join(apoRoot, "skills", "demo_skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill", "utf8");
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), APO_BODY);
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: APO_PROPOSAL }),
    );
    expect(res.status).toBe(500);
  });

  it("approve returns 404 when proposal file is missing (ENOENT on proposal read)", async () => {
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "approve", proposalId: APO_PROPOSAL }),
    );
    expect(res.status).toBe(404);
  });

  it("process-approved treats missing approved directory as empty queue", async () => {
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "process-approved", limit: 2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
  });

  it("apply-approved ignores ENOENT when removing stale approved work item json", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    mkdirSync(path.join(apoRoot, "proposals", "archived"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", APO_PROPOSAL), APO_BODY);
    const skillDir = path.join(apoRoot, "skills", "demo_skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill\n", "utf8");
    writeFileSync(
      path.join(apoRoot, "proposals", "approved", `${APO_PROPOSAL}.json`),
      JSON.stringify({
        proposalId: APO_PROPOSAL,
        skillId: "demo_skill",
        targetPath: path.join(skillDir, "SKILL.md"),
        targetKind: "skill",
        executorCli: "qwen",
        status: "approved",
        approvedAt: new Date().toISOString(),
      }),
    );
    const { POST } = await loadApoRoute(apoRoot);
    const apply = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: APO_PROPOSAL }),
    );
    expect(apply.status).toBe(200);
    const body = await apply.json();
    expect(body.ok).toBe(true);
    expect(body.archived).toBe(true);
  });
});
