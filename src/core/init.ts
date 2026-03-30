import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyDirContents, pathExists } from "./utils.js";

export interface InitOptions {
  force?: boolean;
  template?: string;
}

const BUILTIN_TEMPLATE_ROOT = fileURLToPath(new URL("../../templates", import.meta.url));
const DEFAULT_TEMPLATE = "example-team";

export async function initProject(
  targetDirInput: string,
  options: boolean | InitOptions = {},
): Promise<string[]> {
  const targetDir = path.resolve(targetDirInput);
  const markerPath = path.join(targetDir, "clawsquad.json");
  const resolvedOptions = typeof options === "boolean" ? { force: options } : options;
  const force = resolvedOptions.force ?? false;
  const templateDir = await resolveTemplateDir(resolvedOptions.template);

  if ((await pathExists(markerPath)) && !force) {
    throw new Error(`Project already exists at ${targetDir}. Use --force to overwrite scaffold files.`);
  }

  return (await copyDirContents(templateDir, targetDir)).sort();
}

async function resolveTemplateDir(templateInput: string | undefined): Promise<string> {
  const requestedTemplate = templateInput?.trim() || DEFAULT_TEMPLATE;
  const builtInTemplateDir = path.join(BUILTIN_TEMPLATE_ROOT, requestedTemplate);
  if (await isTemplateDir(builtInTemplateDir)) {
    return builtInTemplateDir;
  }

  const customTemplateDir = path.resolve(requestedTemplate);
  if (await isTemplateDir(customTemplateDir)) {
    return customTemplateDir;
  }

  const builtInTemplates = await listBuiltInTemplates();
  throw new Error(
    `Could not find template "${requestedTemplate}". Try one of: ${builtInTemplates.join(", ")}`,
  );
}

async function isTemplateDir(templateDir: string): Promise<boolean> {
  return pathExists(path.join(templateDir, "clawsquad.json"));
}

async function listBuiltInTemplates(): Promise<string[]> {
  if (!(await pathExists(BUILTIN_TEMPLATE_ROOT))) {
    return [DEFAULT_TEMPLATE];
  }

  const entries = await fs.readdir(BUILTIN_TEMPLATE_ROOT, { withFileTypes: true });
  const templateDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return templateDirs.length > 0 ? templateDirs : [DEFAULT_TEMPLATE];
}
