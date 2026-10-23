// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, closeDb } from "@/lib/db";

const TMP = path.join(os.tmpdir(), `skills-rq-b14b-${crypto.randomUUID()}`);

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  process.env.MEMROOS_ROOT = TMP;
  process.env.SQLITE_DB_PATH = path.join(TMP, `db-${crypto.randomUUID()}.db`);
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  vi.resetModules();
});

afterEach(() => {
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("skills registry + quarantine batch14b", () => {
  it("parseSkillMd handles unclosed frontmatter and verifySkillSignature length mismatch", async () => {
    const { parseSkillMd, signSkill, verifySkillSignature } = await import("../registry");
    const parsed = parseSkillMd("---\nname: open-fm\nversion: 1.0.0\n");
    expect(parsed.name).toBeNull();
    const hash = "a".repeat(64);
    const { signature } = signSkill(hash, "signing-key");
    expect(verifySkillSignature(hash, `${signature}x`, "signing-key")).toBe(false);
  });

  it("normalizeRegistryEntry honors disabled/review frontmatter on incomplete skills", async () => {
    const { parseSkillMd, normalizeRegistryEntry } = await import("../registry");
    const raw = `---
name: incomplete-skill
description:
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: review
version: 1.0.0
---
`;
    const entry = normalizeRegistryEntry(parseSkillMd(raw), "claude", "importer");
    expect(entry.dispatch_status).toBe("review");
  });

  it("signRegistryEntry returns original entry when signing key empty", async () => {
    const { parseSkillMd, normalizeRegistryEntry, signRegistryEntry } = await import("../registry");
    const raw = `---
name: signed-skip
description: d
owner: ops
source_harness: claude
risk_tier: low
version: 1.0.0
---
## Preconditions
ok
## Allowed Tools
ok
## Verification Checks
ok
## Rollback
ok
## Evidence Examples
ok
`;
    const entry = normalizeRegistryEntry(parseSkillMd(raw), "claude", "importer");
    const unsigned = signRegistryEntry(entry, "");
    expect(unsigned.trust_level).toBe("unsigned");
    expect(unsigned.signature).toBeNull();
  });

  it("quarantine parseScannerResult returns null for invalid JSON", async () => {
    const db = getDb();
    const { insertQuarantineRecord, getQuarantineRecord } = await import("../skill-quarantine");
    const skillId = db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES ('q-skill', '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', 'body', 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(new Date().toISOString(), crypto.createHash("sha256").update("body").digest("hex")).lastInsertRowid;
    insertQuarantineRecord(db, { skillId: Number(skillId), stage: "imported" });
    db.prepare(`UPDATE skill_quarantine SET scanner_result = ? WHERE skill_id = ?`).run("{not-json", Number(skillId));
    const loaded = getQuarantineRecord(db, Number(skillId));
    expect(loaded?.scanner_result).toBeNull();
  });
});
