import { promises as fs } from "node:fs";
import path from "node:path";

import type { ApplySummary, JsonMap, JsonValue, LoadedProject } from "./types.js";
import { loadProject, retargetProjectToOpenClawHome } from "./project.js";
import { renderLoadedProject } from "./render.js";
import {
  getOpenClawConfigPath,
  mergeManagedBindingsIntoConfig,
  mergeRolesIntoConfig,
  type ManagedBindingsState,
  type OpenClawConfig,
} from "./openclaw.js";
import {
  copyDirContents,
  ensureDir,
  isJsonMap,
  pathExists,
  readJsonFile,
  runCommand,
  unique,
  writeJsonFile,
} from "./utils.js";

export interface ApplyOverrides {
  restartGateway?: boolean | undefined;
  validateConfig?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export async function applyProject(
  projectDir: string,
  overrides: ApplyOverrides = {},
): Promise<ApplySummary> {
  const sourceProject = await loadProject(projectDir);
  const dryRunContext =
    overrides.dryRun === true ? await prepareDryRunProject(sourceProject) : undefined;
  const project = dryRunContext?.project ?? sourceProject;
  const rendered = await renderLoadedProject(project);
  const configPath = getOpenClawConfigPath(project);

  if (!(await pathExists(configPath))) {
    throw new Error(`Could not find openclaw config at ${configPath}`);
  }

  for (const role of project.roles) {
    await ensureDir(role.targetWorkspaceAbs);
    if (role.targetAgentDirAbs != null) {
      await ensureDir(role.targetAgentDirAbs);
    }
  }

  const config = await readJsonFile<OpenClawConfig>(configPath);
  const statePath = path.join(project.openclawHome, MANAGED_STATE_RECORD);
  const previousState = await readManagedState(statePath);
  const previousStateSnapshot = await readOptionalFileBuffer(statePath);
  const configWithRoles = mergeRolesIntoConfig(config, project.roles);
  const { config: nextConfig, state: nextManagedState } = mergeManagedBindingsIntoConfig(
    configWithRoles,
    project.roles,
    previousState,
  );
  const backupPath = await maybeBackupConfig(project, configPath);

  const validateConfig = overrides.validateConfig ?? project.manifest.apply?.validateConfig ?? true;
  const requestedRestart =
    overrides.restartGateway ?? project.manifest.apply?.restartGateway ?? false;
  const restartGateway = dryRunContext == null ? requestedRestart : false;
  const updatedFiles: string[] = [];
  const workspaceRollbacks: Array<() => Promise<void>> = [];

  try {
    await writeJsonFile(configPath, nextConfig);

    if (validateConfig) {
      await runOpenClawCommand(project, ["config", "validate"]);
    }

    for (const role of project.roles) {
      const renderedFiles = rendered.filesByRole[role.manifest.id] ?? [];
      const result = await syncManagedWorkspaceFiles(
        role.targetWorkspaceAbs,
        role.renderedDir,
        renderedFiles.map((file) => file.relativePath),
      );
      workspaceRollbacks.push(result.rollback);
      updatedFiles.push(...result.changedPaths);
    }

    await writeJsonFile(statePath, nextManagedState);
    updatedFiles.push(statePath);
  } catch (error) {
    await restoreConfig(configPath, config, backupPath);
    await restoreOptionalFileBuffer(statePath, previousStateSnapshot);
    for (const rollback of workspaceRollbacks.reverse()) {
      await rollback();
    }
    throw error;
  }

  if (restartGateway) {
    await runOpenClawCommand(project, ["gateway", "restart"]);
  }

  return {
    project,
    configPath,
    renderedRoles: Object.keys(rendered.filesByRole),
    updatedFiles,
    dryRun: dryRunContext != null,
    backupPath,
    sourceOpenclawHome: dryRunContext?.sourceOpenclawHome,
    dryRunSandboxRoot: dryRunContext?.sandboxRoot,
    validated: validateConfig,
    restarted: restartGateway,
  };
}

const MANAGED_FILES_RECORD = ".clawsquad-managed.json";
const MANAGED_STATE_RECORD = ".clawsquad-state.json";
const DRY_RUN_ROOT = "/tmp";

interface DryRunContext {
  project: LoadedProject;
  sourceOpenclawHome: string;
  sandboxRoot: string;
}

async function maybeBackupConfig(project: LoadedProject, configPath: string): Promise<string | undefined> {
  const shouldBackup = project.manifest.apply?.backupConfig ?? true;
  if (!shouldBackup) {
    return undefined;
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = `${configPath}.clawsquad.${timestamp}.bak`;
  await fs.copyFile(configPath, backupPath);
  return backupPath;
}

async function restoreConfig(
  configPath: string,
  previousConfig: OpenClawConfig,
  backupPath: string | undefined,
): Promise<void> {
  if (backupPath != null && (await pathExists(backupPath))) {
    await fs.copyFile(backupPath, configPath);
    return;
  }

  await writeJsonFile(configPath, previousConfig);
}

async function syncManagedWorkspaceFiles(
  workspaceDir: string,
  renderedDir: string,
  currentRelativePaths: string[],
): Promise<{ changedPaths: string[]; rollback: () => Promise<void> }> {
  const metadataPath = path.join(workspaceDir, MANAGED_FILES_RECORD);
  const previousRelativePaths = await readManagedFilesMetadata(metadataPath);
  const currentSet = new Set(currentRelativePaths);
  const changedPaths: string[] = [];
  const snapshot = await createWorkspaceSnapshot(workspaceDir, [
    ...new Set([...previousRelativePaths, ...currentRelativePaths, MANAGED_FILES_RECORD]),
  ]);

  try {
    for (const previousPath of previousRelativePaths) {
      if (currentSet.has(previousPath)) {
        continue;
      }

      const targetPath = path.join(workspaceDir, previousPath);
      await fs.rm(targetPath, { force: true });
      changedPaths.push(targetPath);
    }

    changedPaths.push(...(await copyDirContents(renderedDir, workspaceDir)));
    await writeJsonFile(metadataPath, {
      version: 1,
      managedFiles: currentRelativePaths,
    });
    changedPaths.push(metadataPath);
  } catch (error) {
    await restoreWorkspaceSnapshot(workspaceDir, snapshot);
    throw error;
  }

  return {
    changedPaths,
    rollback: async () => restoreWorkspaceSnapshot(workspaceDir, snapshot),
  };
}

async function readManagedFilesMetadata(metadataPath: string): Promise<string[]> {
  if (!(await pathExists(metadataPath))) {
    return [];
  }

  try {
    const data = await readJsonFile<{ managedFiles?: unknown }>(metadataPath);
    if (!Array.isArray(data.managedFiles)) {
      return [];
    }

    return data.managedFiles.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

async function readManagedState(statePath: string): Promise<ManagedBindingsState | undefined> {
  if (!(await pathExists(statePath))) {
    return undefined;
  }

  try {
    const data = await readJsonFile<{
      version?: unknown;
      managedBindingKeys?: unknown;
    }>(statePath);
    if (data.version !== 1 || !Array.isArray(data.managedBindingKeys)) {
      return undefined;
    }

    return {
      version: 1,
      managedBindingKeys: data.managedBindingKeys.filter(
        (entry): entry is string => typeof entry === "string",
      ),
    };
  } catch {
    return undefined;
  }
}

async function readOptionalFileBuffer(filePath: string): Promise<Buffer | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }
  return fs.readFile(filePath);
}

async function restoreOptionalFileBuffer(filePath: string, content: Buffer | undefined): Promise<void> {
  if (content == null) {
    await fs.rm(filePath, { force: true });
    return;
  }

  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
}

type WorkspaceSnapshotEntry = {
  exists: boolean;
  content?: Buffer;
};

async function createWorkspaceSnapshot(
  workspaceDir: string,
  relativePaths: string[],
): Promise<Map<string, WorkspaceSnapshotEntry>> {
  const snapshot = new Map<string, WorkspaceSnapshotEntry>();

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(workspaceDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      snapshot.set(relativePath, { exists: false });
      continue;
    }

    snapshot.set(relativePath, {
      exists: true,
      content: await fs.readFile(absolutePath),
    });
  }

  return snapshot;
}

async function restoreWorkspaceSnapshot(
  workspaceDir: string,
  snapshot: Map<string, WorkspaceSnapshotEntry>,
): Promise<void> {
  for (const [relativePath, entry] of [...snapshot.entries()].reverse()) {
    const absolutePath = path.join(workspaceDir, relativePath);
    if (!entry.exists) {
      await fs.rm(absolutePath, { force: true });
      continue;
    }

    await ensureDir(path.dirname(absolutePath));
    if (entry.content == null) {
      throw new Error(`Workspace snapshot for ${absolutePath} is missing file content`);
    }
    await fs.writeFile(absolutePath, entry.content);
  }
}

async function runOpenClawCommand(project: LoadedProject, args: string[]): Promise<void> {
  const configPath = getOpenClawConfigPath(project);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_HOME: project.openclawHome,
    OPENCLAW_CONFIG_PATH: configPath,
  };

  try {
    await runCommand("openclaw", args, path.dirname(project.manifestPath), env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run "openclaw ${args.join(" ")}": ${message}`);
  }
}

async function prepareDryRunProject(project: LoadedProject): Promise<DryRunContext> {
  const sourceOpenclawHome = project.openclawHome;
  const sandboxRoot = await fs.mkdtemp(path.join(DRY_RUN_ROOT, "clawsquad-dryrun-"));
  const sandboxHome = path.join(sandboxRoot, path.basename(sourceOpenclawHome) || "openclaw-home");
  const sourceConfigPath = getOpenClawConfigPath(project);

  if (!(await pathExists(sourceConfigPath))) {
    throw new Error(`Could not find openclaw config at ${sourceConfigPath}`);
  }

  await ensureDir(sandboxHome);

  const sourceConfig = await readJsonFile<OpenClawConfig>(sourceConfigPath);
  await copySandboxInputs(project, sourceConfig, sandboxHome);

  const sandboxConfig = rewriteHomePathsInJson(
    sourceConfig,
    sourceOpenclawHome,
    sandboxHome,
  ) as OpenClawConfig;
  await writeJsonFile(path.join(sandboxHome, "openclaw.json"), sandboxConfig);

  const sourceStatePath = path.join(sourceOpenclawHome, MANAGED_STATE_RECORD);
  const sandboxStatePath = path.join(sandboxHome, MANAGED_STATE_RECORD);
  if (await pathExists(sourceStatePath)) {
    await fs.copyFile(sourceStatePath, sandboxStatePath);
  }

  return {
    project: retargetProjectToOpenClawHome(project, sandboxHome),
    sourceOpenclawHome,
    sandboxRoot,
  };
}

async function copySandboxInputs(
  project: LoadedProject,
  config: OpenClawConfig,
  sandboxHome: string,
): Promise<void> {
  const sourcePaths = unique([
    ...collectHomeScopedPaths(config, project.openclawHome),
    ...project.roles.map((role) => role.targetWorkspaceAbs),
    ...project.roles.flatMap((role) => (role.targetAgentDirAbs == null ? [] : [role.targetAgentDirAbs])),
  ]).sort();

  for (const sourcePath of sourcePaths) {
    const sandboxPath = remapHomePath(sourcePath, project.openclawHome, sandboxHome);
    if (sandboxPath == null) {
      continue;
    }
    await copyPathIfExists(sourcePath, sandboxPath);
  }
}

function collectHomeScopedPaths(value: unknown, openclawHome: string): string[] {
  if (typeof value === "string") {
    const mappedPath = remapHomePath(value, openclawHome, openclawHome);
    return mappedPath == null ? [] : [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectHomeScopedPaths(entry, openclawHome));
  }

  if (!isJsonMap(value)) {
    return [];
  }

  return Object.values(value).flatMap((entry) => collectHomeScopedPaths(entry, openclawHome));
}

function remapHomePath(
  candidatePath: string,
  sourceOpenclawHome: string,
  targetOpenclawHome: string,
): string | undefined {
  if (!path.isAbsolute(candidatePath)) {
    return undefined;
  }

  const relative = path.relative(sourceOpenclawHome, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }

  return relative === "" ? targetOpenclawHome : path.join(targetOpenclawHome, relative);
}

async function copyPathIfExists(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  const stat = await fs.lstat(sourcePath);
  await ensureDir(path.dirname(targetPath));

  if (stat.isDirectory()) {
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
    return;
  }

  await fs.copyFile(sourcePath, targetPath);
}

function rewriteHomePathsInJson(
  value: JsonValue | JsonMap | unknown,
  sourceOpenclawHome: string,
  targetOpenclawHome: string,
): JsonValue | unknown {
  if (typeof value === "string") {
    return remapHomePath(value, sourceOpenclawHome, targetOpenclawHome) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteHomePathsInJson(entry, sourceOpenclawHome, targetOpenclawHome),
    );
  }

  if (!isJsonMap(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      rewriteHomePathsInJson(entry, sourceOpenclawHome, targetOpenclawHome),
    ]),
  );
}
