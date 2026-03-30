#!/usr/bin/env node

import path from "node:path";

import { applyProject } from "./core/apply.js";
import { doctorProject } from "./core/doctor.js";
import { initProject } from "./core/init.js";
import { renderProject } from "./core/render.js";
import { buildTopology } from "./core/topology.js";
import { loadProject } from "./core/project.js";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command == null || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  try {
    switch (command) {
      case "init":
        await runInit(rest);
        return;
      case "render":
        await runRender(rest);
        return;
      case "apply":
        await runApply(rest);
        return;
      case "doctor":
        await runDoctor(rest);
        return;
      case "topology":
        await runTopology(rest);
        return;
      default:
        throw new Error(`Unknown command "${command}"`);
    }
  } catch (error) {
    console.error(`clawsquad error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function runInit(args: string[]): Promise<void> {
  const options = parseArgs(args, new Set(["template"]));
  const targetDir = path.resolve(options.positionals[0] ?? process.cwd());
  const template = resolveStringFlag(options.values, "template");
  const written = await initProject(
    targetDir,
    template == null
      ? { force: options.flags.has("force") }
      : { force: options.flags.has("force"), template },
  );
  console.log(`Initialized clawsquad project in ${targetDir}`);
  console.log(`Wrote ${written.length} file(s).`);
}

async function runRender(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectDir = path.resolve(options.positionals[0] ?? process.cwd());
  const summary = await renderProject(projectDir);
  const fileCount = Object.values(summary.filesByRole).reduce((total, files) => total + files.length, 0);
  console.log(`Rendered ${fileCount} file(s) for ${summary.project.roles.length} role(s).`);
  for (const [roleId, files] of Object.entries(summary.filesByRole)) {
    console.log(`- ${roleId}: ${files.length} file(s) -> ${summary.project.roles.find((role) => role.manifest.id === roleId)?.renderedDir}`);
  }
}

async function runApply(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectDir = path.resolve(options.positionals[0] ?? process.cwd());
  const summary = await applyProject(projectDir, {
    dryRun: resolveBooleanFlag(options.flags, "dry-run"),
    restartGateway: resolveBooleanFlag(options.flags, "restart"),
    validateConfig: resolveBooleanFlag(options.flags, "validate"),
  });

  console.log(
    `Applied ${summary.renderedRoles.length} role(s) into ${summary.project.openclawHome}${
      summary.dryRun ? " (dry-run sandbox)" : ""
    }`,
  );
  if (summary.dryRun) {
    console.log(`Source OpenClaw home: ${summary.sourceOpenclawHome}`);
    console.log(`Sandbox: ${summary.dryRunSandboxRoot}`);
  }
  console.log(`Updated ${summary.updatedFiles.length} workspace file(s).`);
  console.log(`Config: ${summary.configPath}`);
  if (summary.backupPath != null) {
    console.log(`Backup: ${summary.backupPath}`);
  }
  console.log(`Validated: ${summary.validated ? "yes" : "no"}`);
  console.log(`Restarted: ${summary.restarted ? "yes" : "no"}`);
}

async function runDoctor(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectDir = path.resolve(options.positionals[0] ?? process.cwd());
  const summary = await doctorProject(projectDir);

  console.log(`Doctor checks for ${summary.project.manifest.name}`);
  for (const check of summary.checks) {
    console.log(`OK: ${check}`);
  }

  if (summary.warnings.length === 0) {
    console.log("No warnings.");
    return;
  }

  for (const warning of summary.warnings) {
    console.log(`WARN: ${warning}`);
  }
}

async function runTopology(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectDir = path.resolve(options.positionals[0] ?? process.cwd());
  const topology = buildTopology(await loadProject(projectDir));
  console.log(JSON.stringify(topology, null, 2));
}

function parseArgs(
  args: string[],
  valueFlags: Set<string> = new Set(),
): { flags: Set<string>; values: Map<string, string>; positionals: string[] } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg == null) {
      continue;
    }
    if (arg.startsWith("--")) {
      const trimmed = arg.slice(2);
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex >= 0) {
        const name = trimmed.slice(0, equalsIndex);
        const value = trimmed.slice(equalsIndex + 1);
        if (valueFlags.has(name)) {
          values.set(name, value);
          continue;
        }
      }

      if (valueFlags.has(trimmed)) {
        const nextArg = args[index + 1];
        if (nextArg == null || nextArg.startsWith("--")) {
          throw new Error(`Flag --${trimmed} requires a value`);
        }
        values.set(trimmed, nextArg);
        index += 1;
        continue;
      }

      flags.add(trimmed);
      continue;
    }
    positionals.push(arg);
  }

  return { flags, values, positionals };
}

function resolveBooleanFlag(flags: Set<string>, name: string): boolean | undefined {
  if (flags.has(name)) {
    return true;
  }
  if (flags.has(`no-${name}`)) {
    return false;
  }
  return undefined;
}

function resolveStringFlag(values: Map<string, string>, name: string): string | undefined {
  return values.get(name);
}

function printHelp(): void {
  console.log(`clawsquad

Usage:
  clawsquad init [dir] [--force] [--template example-team|/path/to/template]
  clawsquad render [dir]
  clawsquad apply [dir] [--dry-run] [--restart|--no-restart] [--validate|--no-validate]
  clawsquad doctor [dir]
  clawsquad topology [dir]

Commands:
  init    copy a new clawsquad project from a built-in or custom template
  render  render role templates into .clawsquad/rendered
  apply   render, write workspace files, and patch openclaw.json
  doctor  validate project structure and local openclaw readiness
  topology  print the machine-readable squad topology JSON
`);
}

void main();
