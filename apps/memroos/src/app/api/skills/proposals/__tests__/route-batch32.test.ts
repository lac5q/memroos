// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

const TMP = path.join(os.tmpdir(), `skills-proposals-b32-${randomUUID()}`);

function hashBody(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP, "proposals.db");
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("POST /api/skills/proposals batch32", () => {
  it("forwards diff_payload objects to detectSkillChange (line 189)", async () => {
    const skillName = `skill-b32-${randomUUID().slice(0, 8)}`;
    const bodyText = `---\nname: ${skillName}\n---\n# Batch32 body`;
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/skills/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_harness: "codex",
          skill_name: skillName,
          detected_content_body: bodyText,
          proposed_by: "scanner-b32",
          diff_payload: { lines_changed: 3, preview: "batch32" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const diffPayload =
      typeof json.proposal?.diff_payload === "string"
        ? (JSON.parse(json.proposal.diff_payload) as { preview?: string })
        : (json.proposal?.diff_payload as { preview?: string } | undefined);
    expect(diffPayload?.preview).toBe("batch32");
    expect(hashBody(bodyText)).toHaveLength(64);
  });
});
