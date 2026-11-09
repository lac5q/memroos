import assert from "node:assert/strict";
import { builtinModules, createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function packageRootFor(entry, expectedName) {
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    const manifestPath = resolve(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(require("node:fs").readFileSync(manifestPath, "utf8"));
      if (manifest.name === expectedName) return directory;
    }
    directory = dirname(directory);
  }
  throw new Error("installed package root not found: " + expectedName);
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    ...options,
    timeout: 60_000,
  });
  assert.equal(result.status, 0, [
    command + " " + args.join(" ") + " failed",
    result.stdout,
    result.stderr,
  ].join("\n"));
  return result.stdout;
}

function readModuleSpecifiers(sourceFile) {
  const specifiers = [];
  for (const directive of sourceFile.typeReferenceDirectives ?? []) {
    const packageName = directive.fileName.startsWith("@")
      ? directive.fileName
      : "@types/" + directive.fileName;
    specifiers.push(packageName);
  }
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function collectExportTargets(value, targets = []) {
  if (typeof value === "string") {
    targets.push(value);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectExportTargets(child, targets);
  }
  return targets;
}

async function assertPortableEntryClosure(installedPackageRoot, manifest) {
  // Walk every package-owned runtime and declaration entry. External package
  // sources are outside this scan; their specifiers must be declared as exact
  // production dependencies and are supplied by the offline consumer install.
  const exportTargets = [...new Set(collectExportTargets(manifest.exports ?? {}))];
  assert.ok(exportTargets.length, "package has no export targets to inspect");
  const pending = exportTargets.map((target) => resolve(installedPackageRoot, target));

  const seen = new Set();
  const builtins = new Set(builtinModules.flatMap((name) => {
    const bare = name.replace(/^node:/, "");
    return [bare, "node:" + bare];
  }));
  const dependencies = manifest.dependencies ?? {};
  while (pending.length) {
    const filename = pending.pop();
    if (seen.has(filename)) continue;
    seen.add(filename);
    assert.ok(existsSync(filename), "missing packed module: " + filename);

    const sourceText = await readFile(filename, "utf8");
    const isDeclaration = filename.endsWith(".d.ts") || filename.endsWith(".d.mts") || filename.endsWith(".d.cts");
    const sourceFile = ts.createSourceFile(
      filename,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      isDeclaration || filename.endsWith(".ts") || filename.endsWith(".mts") || filename.endsWith(".cts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS,
    );
    for (const specifier of readModuleSpecifiers(sourceFile)) {
      assert.ok(
        !specifier.startsWith("@/")
          && !specifier.startsWith("apps/memroos/")
          && !specifier.includes("private-application"),
        "private application import in packed dependency closure: " + specifier,
      );
      assert.ok(!isAbsolute(specifier), "absolute import in packed dependency closure: " + specifier);

      if (specifier.startsWith(".")) {
        const base = resolve(dirname(filename), specifier);
        const candidates = [base, base + ".js", base + ".mjs", base + ".cjs", base + ".json"];
        const target = candidates.find(existsSync);
        assert.ok(target, "unresolved relative import in packed dependency closure: " + specifier);
        const pathFromPackage = relative(installedPackageRoot, target);
        assert.ok(
          pathFromPackage !== ".." && !pathFromPackage.startsWith(".." + sep) && !isAbsolute(pathFromPackage),
          "relative import escaped packed package: " + specifier,
        );
        pending.push(target);
        continue;
      }

      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!builtins.has(specifier) && packageName !== manifest.name) {
        const version = dependencies[packageName];
        assert.ok(version, "undeclared production dependency in packed closure: " + specifier);
        assert.match(
          version,
          /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
          "external dependency is not pinned to an exact version: " + packageName,
        );
      }
    }
  }
}

test("packed memory-core policy and scope subpaths work in an isolated ESM and TypeScript consumer", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "memroos-memory-core-consumer-"));
  const childEnv = { ...process.env };
  delete childEnv.NODE_PATH;
  delete childEnv.NODE_OPTIONS;
  delete childEnv.MEMROOS_ROOT;
  childEnv.npm_config_offline = "true";
  childEnv.npm_config_cache = resolve(temporaryRoot, "npm-cache");

  try {
    const packageManifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
    assert.equal(packageManifest.private, undefined);
    assert.ok(packageManifest.exports["./trained-ranking-contract"]);

    run("npm", ["pack", ".", "--ignore-scripts", "--pack-destination", temporaryRoot], {
      cwd: packageRoot,
      env: childEnv,
    });
    const zodRoot = packageRootFor(require.resolve("zod"), "zod");
    const zodManifest = JSON.parse(await readFile(resolve(zodRoot, "package.json"), "utf8"));
    assert.equal(zodManifest.version, packageManifest.dependencies.zod);
    run("npm", ["pack", zodRoot, "--ignore-scripts", "--pack-destination", temporaryRoot], {
      cwd: temporaryRoot,
      env: childEnv,
    });

    const tarballs = (await readdir(temporaryRoot)).filter((name) => name.endsWith(".tgz"));
    const coreTarball = tarballs.find((name) => name.startsWith("memroos-memory-core-"));
    const zodTarball = tarballs.find((name) => name.startsWith("zod-"));
    assert.ok(coreTarball, "memory-core tarball was not created");
    assert.ok(zodTarball, "local zod dependency tarball was not created");
    await writeFile(resolve(temporaryRoot, "package.json"), JSON.stringify({
      name: "memroos-memory-core-packed-consumer",
      private: true,
      type: "module",
    }));
    run("npm", [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      resolve(temporaryRoot, coreTarball),
      resolve(temporaryRoot, zodTarball),
    ], { cwd: temporaryRoot, env: childEnv });

    const installedRoot = resolve(temporaryRoot, "node_modules/@memroos/memory-core");
    const installedManifest = JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8"));
    assert.equal(installedManifest.private, undefined);
    await assertPortableEntryClosure(installedRoot, installedManifest);

    const esmConsumer = [
      'import assert from "node:assert/strict";',
      'import * as core from "@memroos/memory-core";',
      'import * as policy from "@memroos/memory-core/memory-policy";',
      'import * as scope from "@memroos/memory-core/memory-scope";',
      'assert.equal(core.authorizeMemoryUse, policy.authorizeMemoryUse);',
      'assert.equal(core.hashMemoryEngineScope, scope.hashMemoryEngineScope);',
      'assert.equal(typeof policy.extractMemoryLabelSnapshot, "function");',
      'assert.equal(typeof scope.resolveAuthorizedEngineScope, "function");',
      'const denied = policy.authorizeMemoryUse({ actor: { id: "synthetic-anon", role: "anonymous" }, purpose: "recall", label: {} });',
      'assert.equal(denied.reason, "sealed_content");',
      'const memberAllowed = policy.authorizeMemoryUse({ actor: { id: "synthetic-member", role: "operator", spaceIds: ["synthetic-space"] }, purpose: "recall", label: { visibility: "internal", policy: "indexable", spaceId: "synthetic-space" } });',
      'assert.equal(memberAllowed.decision, "allow");',
      'assert.equal(memberAllowed.reason, "label_allows_use");',
      'const input = { tenantId: "synthetic-tenant", projectId: "synthetic-project", userId: "synthetic-user", agentId: "synthetic-agent", spaceId: "synthetic-space", label: { visibility: "internal", policy: "indexable", domain: "engineering", sensitivity: "pii" }, purpose: "recall", beliefStage: "gold_claim" };',
      'assert.equal(scope.hashMemoryEngineScope(input), "sha256:ff1cd017401aee65e826cb9e92790c1f945f8f1c9e5d7584dd8d820f9608e97a");',
      'assert.throws(() => scope.assertEngineActorScope({ id: "synthetic-other-agent", role: "agent", tenantId: input.tenantId }, input), { message: "scope_actor_mismatch" });',
      'const actor = { id: input.agentId, role: "agent", tenantId: input.tenantId };',
      'const resolved = await scope.resolveAuthorizedEngineScope(async ({ requestedScope }) => requestedScope, actor, input);',
      'assert.deepEqual(resolved, input);',
      'await assert.rejects(scope.resolveAuthorizedEngineScope(async () => null, actor, input), { message: "scope_authorization_denied" });',
    ].join("\n");
    const esmPath = resolve(temporaryRoot, "consumer.mjs");
    await writeFile(esmPath, esmConsumer);
    run(process.execPath, [esmPath], { cwd: temporaryRoot, env: childEnv });

    const typeConsumer = [
      'import { authorizeMemoryUse } from "@memroos/memory-core/memory-policy";',
      'import { hashMemoryEngineScope } from "@memroos/memory-core/memory-scope";',
      'import type { MemoryUseActor, MemoryUsePurpose, VaultLabel } from "@memroos/memory-core/memory-policy";',
      'import type { BeliefStage, MemoryEngineScope } from "@memroos/memory-core/memory-scope";',
      'import type { BeliefStage as RootBeliefStage, VaultLabel as RootVaultLabel } from "@memroos/memory-core";',
      'const actor: MemoryUseActor = { id: "synthetic-user", role: "operator" };',
      'const label: VaultLabel = { visibility: "internal", policy: "indexable" };',
      'const purpose: MemoryUsePurpose = "recall";',
      'const stage: BeliefStage = "gold_claim";',
      'const scope: MemoryEngineScope = { tenantId: "synthetic-tenant", projectId: "synthetic-project", userId: "synthetic-user", agentId: "synthetic-agent", spaceId: "synthetic-space", label, purpose, beliefStage: stage };',
      'const rootLabel: RootVaultLabel = label;',
      'const rootStage: RootBeliefStage = stage;',
      'authorizeMemoryUse({ actor, purpose, label });',
      'hashMemoryEngineScope(scope);',
      'void [rootLabel, rootStage];',
    ].join("\n");
    const typePath = resolve(temporaryRoot, "consumer.mts");
    await writeFile(typePath, typeConsumer);
    const typescriptRoot = packageRootFor(require.resolve("typescript"), "typescript");
    run(process.execPath, [
      resolve(typescriptRoot, "bin/tsc"),
      "--noEmit",
      "--pretty",
      "false",
      "--strict",
      "--skipLibCheck",
      "false",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      typePath,
    ], { cwd: temporaryRoot, env: childEnv });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
