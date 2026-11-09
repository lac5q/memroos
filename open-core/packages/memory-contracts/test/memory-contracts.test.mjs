import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEGACY_MCP_SCOPE_COMPAT_POLICY,
  LEGACY_MCP_SCOPE_EQUIVALENTS,
  MCP_LEGACY_SCOPES,
  MCP_MEMORY_SCOPES,
  OPENAI_APPROVED_TOOLS,
  OPENAI_MEMORY_ERROR_CODES,
  OPENAI_MEMORY_LIMITS,
  OPENAI_MEMORY_TOOL_CONTRACT,
  OPENAI_MEMORY_TOOL_CONTRACT_ID,
  OPENAI_MCP_PROFILE_ID,
  OPENAI_TOOL_SCOPES,
} from "../dist/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(absolute);
    return [absolute];
  });
}

test("exports the stable OpenAI memory wire contract", () => {
  assert.deepEqual(MCP_MEMORY_SCOPES, ["memories:read", "memories:create", "memories:update"]);
  assert.deepEqual(MCP_LEGACY_SCOPES, ["mcp:read", "mcp:write"]);
  assert.equal(LEGACY_MCP_SCOPE_COMPAT_POLICY, "legacy-mcp-scope-compat-v1");
  assert.deepEqual(LEGACY_MCP_SCOPE_EQUIVALENTS, {
    "mcp:read": ["memories:read"],
    "mcp:write": ["memories:create", "memories:update"],
  });
  assert.equal(OPENAI_MCP_PROFILE_ID, "openai");
  assert.equal(OPENAI_MEMORY_TOOL_CONTRACT_ID, "memroos-openai-memory-tools.v3");
  assert.deepEqual(OPENAI_APPROVED_TOOLS, ["get_profile", "search", "fetch", "create_memory", "update_memory"]);
  assert.deepEqual(OPENAI_TOOL_SCOPES, {
    get_profile: "any",
    search: "memories:read",
    fetch: "memories:read",
    create_memory: "memories:create",
    update_memory: "memories:update",
  });
  assert.deepEqual(OPENAI_MEMORY_ERROR_CODES, [
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "FORBIDDEN",
    "SCOPE_REQUIRED",
    "REVISION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "RATE_LIMITED",
    "LIMIT_EXCEEDED",
    "TEMPORARILY_UNAVAILABLE",
  ]);
  assert.deepEqual(OPENAI_MEMORY_LIMITS, {
    searchMaxResults: 20,
    queryMaxChars: 1_000,
    titleMaxChars: 200,
    textMaxChars: 20_000,
    labelsMax: 16,
    labelMaxChars: 64,
    sourceUrlMaxChars: 2_048,
    idempotencyKeyMaxChars: 128,
  });
  assert.equal(OPENAI_MEMORY_TOOL_CONTRACT.id, OPENAI_MEMORY_TOOL_CONTRACT_ID);
  assert.equal(OPENAI_MEMORY_TOOL_CONTRACT.profile, OPENAI_MCP_PROFILE_ID);
  assert.deepEqual(OPENAI_MEMORY_TOOL_CONTRACT.tools.map(({ name }) => name), [...OPENAI_APPROVED_TOOLS]);
});

test("has no private application or learning dependency", () => {
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.dependencies ?? {}, {});

  for (const sourcePath of files(path.join(PACKAGE_ROOT, "src"))) {
    const source = readFileSync(sourcePath, "utf8");
    assert.doesNotMatch(source, /(?:from|import)\s*["'][^"']*(?:apps\/memroos|memory-engine|memory-learning|training|models)[^"']*["']/u);
  }
});

test("loads through the package export from an unpacked consumer", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "memory-contracts-consumer-"));
  try {
    const packed = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const metadata = JSON.parse(packed.stdout);
    const tarball = metadata[0]?.filename;
    assert.equal(typeof tarball, "string");

    const extracted = path.join(temporaryRoot, "extracted");
    mkdirSync(extracted);
    const unpack = spawnSync("tar", ["-xzf", path.join(temporaryRoot, tarball), "-C", extracted], {
      encoding: "utf8",
    });
    assert.equal(unpack.status, 0, unpack.stderr || unpack.stdout);

    const consumer = path.join(temporaryRoot, "consumer");
    const consumerPackage = path.join(consumer, "node_modules", "@memroos", "memory-contracts");
    mkdirSync(path.dirname(consumerPackage), { recursive: true });
    cpSync(path.join(extracted, "package"), consumerPackage, { recursive: true });
    assert.equal(existsSync(path.join(consumerPackage, "node_modules")), false);

    const loaded = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      "import { OPENAI_MEMORY_TOOL_CONTRACT, OPENAI_APPROVED_TOOLS } from '@memroos/memory-contracts';\n"
        + "if (OPENAI_MEMORY_TOOL_CONTRACT.tools.map(({ name }) => name).join(',') !== OPENAI_APPROVED_TOOLS.join(',')) process.exit(1);",
    ], { cwd: consumer, encoding: "utf8" });
    assert.equal(loaded.status, 0, loaded.stderr || loaded.stdout);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
