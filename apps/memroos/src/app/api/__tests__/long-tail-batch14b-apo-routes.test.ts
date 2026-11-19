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
const APO_BODY = `# Proposal
**APO Constraint to add to SKILL.md:**
\`\`\`
Validate retries with auth context.
\`\`\`
`;
const PROPOSAL_ID = "APO_PROPOSAL_demo_skill_demo_20260505_120000.md";

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

describe("batch14b — /api/apo queue + GET cron metadata", () => {
  let apoRoot: string;

  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    apoRoot = mkdtempSync(path.join(tmpdir(), `apo-batch14b-${randomUUID()}-`));
  });

  afterEach(() => {
    rmSync(apoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("POST approve queues a pending proposal into the approved work queue", async () => {
    mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
    mkdirSync(path.join(apoRoot, "skills", "demo"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", PROPOSAL_ID), APO_BODY);
    writeFileSync(path.join(apoRoot, "skills", "demo", "SKILL.md"), "# Demo skill\n");

    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "approve", proposalId: PROPOSAL_ID }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.queued).toBe(true);
    expect(body.targetKind).toBe("skill");
  });

  it("POST approve returns 404 when pending proposal file is missing", async () => {
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/apo`, { action: "approve", proposalId: PROPOSAL_ID })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "Proposal not found" });
  });

  it("POST approve returns 422 when proposal lacks an APO constraint block", async () => {
    mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", PROPOSAL_ID), "# Proposal\nNo constraint here.\n");
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "approve", proposalId: PROPOSAL_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("GET parses cron log timestamps and returns recent lines", async () => {
    mkdirSync(path.join(apoRoot, "proposals"), { recursive: true });
    writeFileSync(
      path.join(apoRoot, "cron.log"),
      ["2026-05-05T12:00:00 Starting APO cycle", "2026-05-05T12:01:00 done"].join("\n")
    );
    const { GET } = await loadApoRoute(apoRoot);
    const body = await (await GET()).json();
    expect(body.stats.recentLogLines.length).toBeGreaterThan(0);
    expect(body.stats.lastRun).toMatch(/2026-05-05/);
  });

  it("POST rejects unsupported actions and missing proposalId", async () => {
    const { POST } = await loadApoRoute(apoRoot);
    const badAction = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "archive-all" }));
    expect(badAction.status).toBe(400);
    const missingId = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "approve" }));
    expect(missingId.status).toBe(400);
  });

  it("POST process-approved reports failures when apply-approved cannot resolve targets", async () => {
    mkdirSync(path.join(apoRoot, "proposals", "approved"), { recursive: true });
    writeFileSync(path.join(apoRoot, "proposals", "approved", PROPOSAL_ID), APO_BODY);
    const { POST } = await loadApoRoute(apoRoot);
    const res = await POST(jsonPost(`${LOOPBACK}/api/apo`, { action: "process-approved", limit: 2 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.failed).toBeGreaterThan(0);
  });
});
