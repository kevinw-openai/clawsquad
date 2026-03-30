import { promises as fs } from "node:fs";
import path from "node:path";

import type { JsonMap, LoadedProject, RenderSummary, TemplateContext } from "./types.js";
import { buildRoleVars, loadProject } from "./project.js";
import {
  ensureDir,
  getByPath,
  readTextFile,
  stringifyJsonValue,
  walkFiles,
  writeTextFile,
} from "./utils.js";

export async function renderProject(projectDir: string): Promise<RenderSummary> {
  return renderLoadedProject(await loadProject(projectDir));
}

export async function renderLoadedProject(project: LoadedProject): Promise<RenderSummary> {
  const filesByRole: RenderSummary["filesByRole"] = {};

  for (const role of project.roles) {
    await fs.rm(role.renderedDir, { recursive: true, force: true });
    const templateFiles = await walkFiles(role.templatesDir);
    const mergedVars = buildRoleVars(project.sharedVars, role.roleVars);
    const context = buildTemplateContext(
      project.manifest.name,
      project.manifest.description ?? "",
      project.openclawHome,
      role,
      mergedVars,
    );
    const renderedFiles = [];

    for (const templateFile of templateFiles) {
      const relativeTemplatePath = path.relative(role.templatesDir, templateFile);
      const { isTemplate, outputRelativePath } = resolveTemplatePath(relativeTemplatePath);
      const outputPath = path.join(role.renderedDir, outputRelativePath);
      const template = await readTextFile(templateFile);
      let content = template;
      if (isTemplate) {
        try {
          content = interpolateTemplate(template, context);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to render ${relativeTemplatePath} for role ${role.manifest.id}: ${message}`,
          );
        }
      }

      await ensureDir(path.dirname(outputPath));
      await writeTextFile(outputPath, content);
      renderedFiles.push({ outputPath, relativePath: outputRelativePath });
    }

    filesByRole[role.manifest.id] = renderedFiles;
  }

  return { project, filesByRole };
}

function resolveTemplatePath(relativeTemplatePath: string): {
  isTemplate: boolean;
  outputRelativePath: string;
} {
  if (relativeTemplatePath.endsWith(".tpl")) {
    return {
      isTemplate: true,
      outputRelativePath: relativeTemplatePath.slice(0, -4),
    };
  }

  const marker = ".template.";
  const markerIndex = relativeTemplatePath.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return {
      isTemplate: true,
      outputRelativePath: `${relativeTemplatePath.slice(0, markerIndex)}.${relativeTemplatePath.slice(markerIndex + marker.length)}`,
    };
  }

  return {
    isTemplate: false,
    outputRelativePath: relativeTemplatePath,
  };
}

export function interpolateTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (_match, token: string) => {
    const value = getByPath(context, token);
    if (value === undefined) {
      throw new Error(`Unknown template token "${token}"`);
    }
    return stringifyJsonValue(value);
  });
}

function buildTemplateContext(
  teamName: string,
  teamDescription: string,
  openclawHome: string,
  role: RenderSummary["project"]["roles"][number],
  vars: JsonMap,
): TemplateContext {
  return {
    team: {
      name: teamName,
      description: teamDescription,
    },
    role: {
      id: role.manifest.id,
      name: role.manifest.name ?? role.manifest.id,
      description: role.manifest.description ?? "",
      subagents: role.manifest.subagents ?? [],
      model: role.manifest.runtime?.model ?? "",
      toolsProfile: role.manifest.runtime?.toolsProfile ?? "",
    },
    vars,
    openclaw: {
      home: openclawHome,
    },
    paths: {
      workspace: role.targetWorkspaceAbs,
      agentDir: role.targetAgentDirAbs ?? "",
    },
  };
}
