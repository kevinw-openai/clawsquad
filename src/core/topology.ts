import path from "node:path";

import { writeJsonFile } from "./utils.js";
import type {
  AgentLane,
  LoadedProject,
  SquadTopology,
  SquadTopologyAgent,
} from "./types.js";

const TOPOLOGY_ARTIFACT_RELATIVE_PATH = ".clawsquad/runtime/topology.json";

export function buildTopology(project: LoadedProject): SquadTopology {
  const managerByRole = buildManagerMap(project);
  const artifactPath = getTopologyArtifactPath(project);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    artifactPath,
    team: {
      name: project.manifest.name,
      description: project.manifest.description ?? "",
      projectDir: project.projectDir,
      openclawHome: project.openclawHome,
    },
    agents: project.roles.map((role) => ({
      id: role.manifest.id,
      name: role.manifest.name ?? role.manifest.id,
      role: role.manifest.name ?? role.manifest.id,
      description: role.manifest.description ?? "",
      managerId: managerByRole.get(role.manifest.id) ?? null,
      lane: resolveLane(role.manifest.id, role.manifest.name, role.manifest.lane, managerByRole.get(role.manifest.id)),
      summary: role.manifest.description ?? `${role.manifest.name ?? role.manifest.id} role in ${project.manifest.name}`,
      workspace: role.targetWorkspaceAbs,
      agentDir: role.targetAgentDirAbs ?? null,
      subagents: [...(role.manifest.subagents ?? [])],
      runtime: {
        model: role.manifest.runtime?.model ?? "",
        toolsProfile: role.manifest.runtime?.toolsProfile ?? "",
      },
    })),
  };
}

export function getTopologyArtifactPath(project: LoadedProject): string {
  return path.join(project.projectDir, TOPOLOGY_ARTIFACT_RELATIVE_PATH);
}

export async function writeTopologyArtifact(project: LoadedProject): Promise<string> {
  const artifactPath = getTopologyArtifactPath(project);
  await writeJsonFile(artifactPath, buildTopology(project));
  return artifactPath;
}

function buildManagerMap(project: LoadedProject): Map<string, string> {
  const managerByRole = new Map<string, string>();

  for (const role of project.roles) {
    for (const subagentId of role.manifest.subagents ?? []) {
      managerByRole.set(subagentId, role.manifest.id);
    }
  }

  return managerByRole;
}

function resolveLane(
  roleId: string,
  roleName: string | undefined,
  explicitLane: AgentLane | undefined,
  managerId: string | undefined,
): AgentLane {
  if (explicitLane != null) {
    return explicitLane;
  }

  if (managerId == null) {
    return "command";
  }

  const label = `${roleId} ${roleName ?? ""}`.toLowerCase();

  if (/(review|qa|test|audit|verify|quality)/.test(label)) {
    return "quality";
  }
  if (/(research|analysis|investigate|discover)/.test(label)) {
    return "research";
  }
  if (/(plan|lead|coord|manage|orchestr|triage)/.test(label)) {
    return "planning";
  }
  if (/(build|code|develop|engineer|implement|deliver)/.test(label)) {
    return "execution";
  }

  return "execution";
}
