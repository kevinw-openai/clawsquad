import path from "node:path";

import type {
  AgentLane,
  JsonMap,
  LoadedProject,
  LoadedRole,
  SquadManifest,
  SquadRoleManifest,
} from "./types.js";
import {
  deepMerge,
  expandHome,
  pathExists,
  readJsonFile,
  readOptionalJsonMap,
  unique,
} from "./utils.js";

const DEFAULT_RENDERED_DIR = ".clawsquad/rendered";

export async function loadProject(projectDirInput: string): Promise<LoadedProject> {
  const projectDir = path.resolve(projectDirInput);
  const manifestPath = path.join(projectDir, "clawsquad.json");

  if (!(await pathExists(manifestPath))) {
    throw new Error(`Could not find clawsquad.json in ${projectDir}`);
  }

  const manifest = await readJsonFile<SquadManifest>(manifestPath);
  validateManifestShape(manifest, manifestPath);

  const openclawHome = path.resolve(projectDir, expandHome(manifest.openclawHome ?? "~/.openclaw"));
  const renderedRoot = path.join(projectDir, manifest.apply?.renderedDir ?? DEFAULT_RENDERED_DIR);
  const sharedVarsPath =
    manifest.sharedVarsFile == null
      ? undefined
      : path.resolve(projectDir, manifest.sharedVarsFile);
  const sharedVars = await readOptionalJsonMap(sharedVarsPath);

  const seenRoleIds = unique(manifest.roles.map((role) => role.id));
  if (seenRoleIds.length !== manifest.roles.length) {
    throw new Error(`Role ids must be unique in ${manifestPath}`);
  }

  const roles: LoadedRole[] = [];
  for (const roleManifest of manifest.roles) {
    const templatesDir = path.resolve(projectDir, roleManifest.templatesDir);
    if (!(await pathExists(templatesDir))) {
      throw new Error(`Templates directory does not exist for role ${roleManifest.id}: ${templatesDir}`);
    }

    const varsPath =
      roleManifest.varsFile == null ? undefined : path.resolve(projectDir, roleManifest.varsFile);
    const roleVars = await readOptionalJsonMap(varsPath);
    const targetWorkspaceRel = roleManifest.workspaceDir ?? defaultWorkspaceDir(roleManifest.id);
    const targetWorkspaceAbs = path.join(openclawHome, targetWorkspaceRel);
    const targetAgentDirRel =
      roleManifest.agentDir === null
        ? undefined
        : roleManifest.agentDir ?? defaultAgentDir(roleManifest.id);
    const targetAgentDirAbs =
      targetAgentDirRel == null ? undefined : path.join(openclawHome, targetAgentDirRel);

    roles.push({
      manifest: roleManifest,
      templatesDir,
      roleVars,
      renderedDir: path.join(renderedRoot, roleManifest.id),
      targetWorkspaceRel,
      targetWorkspaceAbs,
      targetAgentDirRel,
      targetAgentDirAbs,
    });
  }

  validateSubagents(manifest.roles, manifestPath);

  return {
    projectDir,
    manifestPath,
    manifest,
    openclawHome,
    renderedRoot,
    sharedVars,
    roles,
  };
}

export function retargetProjectToOpenClawHome(
  project: LoadedProject,
  openclawHomeInput: string,
): LoadedProject {
  const openclawHome = path.resolve(openclawHomeInput);

  return {
    ...project,
    openclawHome,
    roles: project.roles.map((role) => ({
      ...role,
      targetWorkspaceAbs: path.join(openclawHome, role.targetWorkspaceRel),
      targetAgentDirAbs:
        role.targetAgentDirRel == null ? undefined : path.join(openclawHome, role.targetAgentDirRel),
    })),
  };
}

export function buildRoleVars(sharedVars: JsonMap, roleVars: JsonMap): JsonMap {
  return deepMerge(sharedVars, roleVars);
}

function validateManifestShape(manifest: SquadManifest, manifestPath: string): void {
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    throw new Error(`Manifest ${manifestPath} must include a non-empty "name"`);
  }

  if (!Array.isArray(manifest.roles) || manifest.roles.length === 0) {
    throw new Error(`Manifest ${manifestPath} must include at least one role`);
  }

  for (const role of manifest.roles) {
    if (typeof role.id !== "string" || role.id.trim() === "") {
      throw new Error(`Each role in ${manifestPath} must include a non-empty "id"`);
    }
    if (typeof role.templatesDir !== "string" || role.templatesDir.trim() === "") {
      throw new Error(`Role ${role.id} in ${manifestPath} must include "templatesDir"`);
    }
    if (role.workspaceDir != null && (typeof role.workspaceDir !== "string" || role.workspaceDir.trim() === "")) {
      throw new Error(
        `Role ${role.id} in ${manifestPath} must use a non-empty string for "workspaceDir"`,
      );
    }
    if (
      role.agentDir !== undefined &&
      role.agentDir !== null &&
      (typeof role.agentDir !== "string" || role.agentDir.trim() === "")
    ) {
      throw new Error(
        `Role ${role.id} in ${manifestPath} must use a non-empty string or null for "agentDir"`,
      );
    }
    if (role.bindings != null && !Array.isArray(role.bindings)) {
      throw new Error(`Role ${role.id} in ${manifestPath} must use an array for "bindings"`);
    }
    if (role.lane != null && !isAgentLane(role.lane)) {
      throw new Error(
        `Role ${role.id} in ${manifestPath} must use one of the supported "lane" values`,
      );
    }
  }
}

function validateSubagents(roles: SquadRoleManifest[], manifestPath: string): void {
  const roleIds = new Set(roles.map((role) => role.id));
  const managerByRole = new Map<string, string>();

  for (const role of roles) {
    for (const target of role.subagents ?? []) {
      if (!roleIds.has(target)) {
        throw new Error(
          `Role ${role.id} in ${manifestPath} references missing subagent "${target}"`,
        );
      }
      const existingManager = managerByRole.get(target);
      if (existingManager != null && existingManager !== role.id) {
        throw new Error(
          `Role ${target} in ${manifestPath} cannot be managed by both ${existingManager} and ${role.id}`,
        );
      }
      managerByRole.set(target, role.id);
    }
  }
}

function defaultWorkspaceDir(roleId: string): string {
  return `workspace-${roleId}`;
}

function defaultAgentDir(roleId: string): string | undefined {
  return `agents/${roleId}/agent`;
}

function isAgentLane(value: string): value is AgentLane {
  return (
    value === "command" ||
    value === "planning" ||
    value === "research" ||
    value === "execution" ||
    value === "quality"
  );
}
