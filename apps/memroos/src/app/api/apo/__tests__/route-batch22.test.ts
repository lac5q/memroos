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
Validate retries with auth context batch22.
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
  vi.stubEnv("HOME", apoRoot);
  return import("../route");
}

describe("apo route batch22 — unlink errno branches", () => {
  let apoRoot: string;

  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    apoRoot = mkdtempSync(path.join(tmpdir(), `apo-b22-${randomUUID()}-`));
  });

  afterEach(() => {
    rmSync(apoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.doUnmock("fs/promises");
    vi.resetModules();
  });

  it("apply-approved rethrows unlink failures other than ENOENT", async () => {
    vi.doMock("fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("fs/promises")>();
      return {
        ...actual,
        unlink: vi.fn(async (filePath: string) => {
          if (String(filePath).endsWith(".json") && String(filePath).includes("approved")) {
            const err = new Error("EPERM") as NodeJS.ErrnoException;
            err.code = "EPERM";
            throw err;
          }
          return actual.unlink(filePath);
        }),
      };
    });

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
      })
    );

    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "apply-approved", proposalId: APO_PROPOSAL }));
    expect(res.status).toBe(500);
  });
});
