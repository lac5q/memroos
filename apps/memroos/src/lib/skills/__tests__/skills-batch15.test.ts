// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, closeDb } from "@/lib/db";
import { computeContentHash } from "@/lib/skills/registry";

const renameFailState = vi.hoisted(() => ({ enabled: false }));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    renameSync: (src: fs.PathLike, dest: fs.PathLike) => {
      if (renameFailState.enabled) {
        throw new Error("cross-device rename");
      }
      return actual.renameSync(src, dest);
    },
  };
});

const TMP_ROOT = path.join(os.tmpdir(), `skills-b15-${crypto.randomUUID()}`);

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: test
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## body
`;

beforeEach(() => {
  renameFailState.enabled = false;
  vi.resetModules();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `db-${crypto.randomUUID()}.db`);
  try {
    closeDb();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("skills batch15 — skill-signing and skill-sync edges", () => {
  it("verifySkill rejects non-public keys, empty buffers, and invalid signatures", async () => {
    const { verifySkill, signSkill } = await import("../skill-signing");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const hash = "sha256:deadbeef";
    const signature = signSkill(privateKey, hash);
    expect(verifySkill(privateKey as unknown as import("crypto").KeyObject, hash, signature)).toBe(false);
    expect(verifySkill(publicKey, hash, "")).toBe(false);
    expect(verifySkill(publicKey, hash, "!!!")).toBe(false);
    expect(verifySkill(publicKey, hash, signature)).toBe(true);
  });

  it("readOperatorKeyFile returns null for malformed files and writeOperatorKeyFile falls back when rename fails", async () => {
    const signing = await import("../skill-signing");
    const repoRoot = path.join(TMP_ROOT, "repo-signing");
    fs.mkdirSync(repoRoot, { recursive: true });
    const badPath = signing.resolveOperatorKeyPath(repoRoot);
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, "{not-json", "utf8");
    expect(signing.readOperatorKeyFile(repoRoot)).toBeNull();

    fs.writeFileSync(badPath, JSON.stringify({ public_key_pem: "x" }), "utf8");
    expect(signing.readOperatorKeyFile(repoRoot)).toBeNull();

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const file = {
      algorithm: "ed25519" as const,
      public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      private_key_pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      public_key_fingerprint: signing.publicKeyFingerprint(publicKey),
      generated_at: new Date().toISOString(),
    };
    renameFailState.enabled = true;
    const written = signing.writeOperatorKeyFile(file, repoRoot);
    expect(fs.existsSync(written)).toBe(true);
  });

  it("detectHarnessSkills handles empty version frontmatter and approveSyncProposalById with null source_root", async () => {
    const db = getDb();
    const { detectHarnessSkills, createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const roots = {
      claude: path.join(TMP_ROOT, "claude-skills"),
      codex: path.join(TMP_ROOT, "codex-skills"),
      hermes: path.join(TMP_ROOT, "hermes-skills"),
      opencode: path.join(TMP_ROOT, "opencode-skills"),
    };
    fs.mkdirSync(roots.claude, { recursive: true });
    fs.writeFileSync(
      path.join(roots.claude, "empty-version.md"),
      VALID_SKILL_MD("empty-version", "").replace("version: \n", "version:\n"),
    );

    const scan = detectHarnessSkills({ roots });
    expect(scan.entries.some((e) => e.skill_name === "empty-version")).toBe(true);

    const skillName = `guard-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
        file_path: path.join(TMP_ROOT, "outside.md"),
      },
      proposed_by: "scanner",
      source_root: null,
    });
    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: proposal.proposal.pending_proposal_id!,
        operator: "operator",
        apply_to_registry: false,
      }),
    ).not.toThrow();
  });
});
