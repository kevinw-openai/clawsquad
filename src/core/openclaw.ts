import path from "node:path";

import type {
  JsonMap,
  LoadedProject,
  LoadedRole,
  SquadBindingManifest,
} from "./types.js";

export interface OpenClawConfig extends JsonMap {
  agents?: {
    defaults?: JsonMap;
    list?: JsonMap[];
  };
  bindings?: JsonMap[];
}

export function getOpenClawConfigPath(project: LoadedProject): string {
  return path.join(project.openclawHome, "openclaw.json");
}

export function mergeRolesIntoConfig(config: OpenClawConfig, roles: LoadedRole[]): OpenClawConfig {
  const nextConfig: OpenClawConfig = structuredClone(config);
  const agentsRoot = (nextConfig.agents ??= {});
  const list = Array.isArray(agentsRoot.list) ? [...agentsRoot.list] : [];

  for (const role of roles) {
    const existingIndex = list.findIndex((entry) => entry.id === role.manifest.id);
    const existing = existingIndex >= 0 ? (list[existingIndex] ?? {}) : {};
    const nextAgent = mergeSingleRole(existing, role);

    if (existingIndex >= 0) {
      list[existingIndex] = nextAgent;
    } else {
      list.push(nextAgent);
    }
  }

  agentsRoot.list = list;
  return nextConfig;
}

export interface ManagedBindingsState {
  version: 1;
  managedBindingKeys: string[];
}

export function mergeManagedBindingsIntoConfig(
  config: OpenClawConfig,
  roles: LoadedRole[],
  previousState: ManagedBindingsState | undefined,
): { config: OpenClawConfig; state: ManagedBindingsState } {
  const nextConfig: OpenClawConfig = structuredClone(config);
  const existingBindings = Array.isArray(nextConfig.bindings) ? [...nextConfig.bindings] : [];
  const previousManagedKeys = new Set(previousState?.managedBindingKeys ?? []);
  const currentBindings = roles.flatMap((role) =>
    (role.manifest.bindings ?? []).map((binding) => materializeBinding(role.manifest.id, binding)),
  );
  const currentManagedKeys = new Set(currentBindings.map((binding) => buildBindingKey(binding)));

  const retainedBindings = existingBindings.filter((binding) => {
    const key = buildBindingKey(binding);
    if (currentManagedKeys.has(key)) {
      return false;
    }
    if (previousManagedKeys.has(key)) {
      return false;
    }
    return true;
  });

  const mergedBindings = [...retainedBindings, ...currentBindings];
  if (mergedBindings.length > 0) {
    nextConfig.bindings = mergedBindings;
  } else {
    delete nextConfig.bindings;
  }

  return {
    config: nextConfig,
    state: {
      version: 1,
      managedBindingKeys: [...currentManagedKeys].sort(),
    },
  };
}

export function mergeSingleRole(existing: JsonMap, role: LoadedRole): JsonMap {
  const nextAgent: JsonMap = { ...existing, id: role.manifest.id };

  if (role.manifest.name != null) {
    nextAgent.name = role.manifest.name;
  }

  nextAgent.workspace = role.targetWorkspaceAbs;

  if (role.targetAgentDirAbs != null) {
    nextAgent.agentDir = role.targetAgentDirAbs;
  } else {
    delete nextAgent.agentDir;
  }

  if (role.manifest.runtime?.model != null) {
    nextAgent.model = role.manifest.runtime.model;
  }

  if (role.manifest.runtime?.toolsProfile != null) {
    const tools =
      nextAgent.tools != null && typeof nextAgent.tools === "object" && !Array.isArray(nextAgent.tools)
        ? { ...(nextAgent.tools as JsonMap) }
        : {};
    tools.profile = role.manifest.runtime.toolsProfile;
    nextAgent.tools = tools;
  }

  if (role.manifest.subagents != null) {
    const subagents =
      nextAgent.subagents != null &&
      typeof nextAgent.subagents === "object" &&
      !Array.isArray(nextAgent.subagents)
        ? { ...(nextAgent.subagents as JsonMap) }
        : {};
    subagents.allowAgents = [...role.manifest.subagents];
    nextAgent.subagents = subagents;
  }

  return nextAgent;
}

function materializeBinding(agentId: string, binding: SquadBindingManifest): JsonMap {
  const result: JsonMap = {
    agentId,
    match: normalizeBindingMatch(binding.match),
  };

  if (binding.type != null) {
    result.type = binding.type;
  }

  if (binding.comment != null) {
    result.comment = binding.comment;
  }

  if (binding.type === "acp" && binding.acp != null) {
    result.acp = { ...binding.acp };
  }

  return result;
}

function normalizeBindingMatch(match: SquadBindingManifest["match"]): JsonMap {
  const normalized: JsonMap = {
    channel: match.channel,
  };

  if (match.accountId != null) {
    normalized.accountId = match.accountId;
  }
  if (match.peer != null) {
    normalized.peer = {
      kind: match.peer.kind,
      id: match.peer.id,
    };
  }
  if (match.guildId != null) {
    normalized.guildId = match.guildId;
  }
  if (match.teamId != null) {
    normalized.teamId = match.teamId;
  }
  if (match.roles != null) {
    normalized.roles = [...match.roles].sort();
  }

  return normalized;
}

function buildBindingKey(binding: JsonMap): string {
  const type = typeof binding.type === "string" ? binding.type : "route";
  const agentId = typeof binding.agentId === "string" ? binding.agentId : "";
  const comment = typeof binding.comment === "string" ? binding.comment : "";
  const match = (binding.match ?? {}) as JsonMap;
  const peer = (match.peer ?? {}) as JsonMap;
  const roles = Array.isArray(match.roles)
    ? match.roles.filter((value): value is string => typeof value === "string").sort()
    : [];
  const acp = (binding.acp ?? {}) as JsonMap;

  return JSON.stringify({
    type,
    agentId,
    comment,
    match: {
      channel: match.channel ?? "",
      accountId: match.accountId ?? "",
      peerKind: peer.kind ?? "",
      peerId: peer.id ?? "",
      guildId: match.guildId ?? "",
      teamId: match.teamId ?? "",
      roles,
    },
    acp: {
      mode: acp.mode ?? "",
      label: acp.label ?? "",
      cwd: acp.cwd ?? "",
      backend: acp.backend ?? "",
    },
  });
}
