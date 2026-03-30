import path from "node:path";

import type { DoctorSummary } from "./types.js";
import { loadProject } from "./project.js";
import { pathExists, runCommand, walkFiles } from "./utils.js";

export async function doctorProject(projectDir: string): Promise<DoctorSummary> {
  const project = await loadProject(projectDir);
  const warnings: string[] = [];
  const checks: string[] = [];

  if (!(await pathExists(project.openclawHome))) {
    throw new Error(`OpenClaw home does not exist: ${project.openclawHome}`);
  }
  checks.push(`openclaw home found: ${project.openclawHome}`);

  const configPath = path.join(project.openclawHome, "openclaw.json");
  if (!(await pathExists(configPath))) {
    throw new Error(`openclaw.json does not exist at ${configPath}`);
  }
  checks.push(`openclaw config found: ${configPath}`);

  for (const role of project.roles) {
    const files = await walkFiles(role.templatesDir);
    if (files.length === 0) {
      warnings.push(`role ${role.manifest.id} has an empty templates directory`);
    } else {
      checks.push(`role ${role.manifest.id} templates found: ${files.length} file(s)`);
    }

    const expectedFiles = ["AGENTS", "SOUL", "USER"];
    for (const expectedFile of expectedFiles) {
      const modernPath = path.join(role.templatesDir, `${expectedFile}.template.md`);
      const legacyPath = path.join(role.templatesDir, `${expectedFile}.md.tpl`);
      if (!(await pathExists(modernPath)) && !(await pathExists(legacyPath))) {
        warnings.push(
          `role ${role.manifest.id} is missing ${expectedFile}.template.md (or legacy ${expectedFile}.md.tpl)`,
        );
      }
    }
  }

  try {
    await runCommand("openclaw", ["config", "validate"], project.projectDir, {
      ...process.env,
      OPENCLAW_HOME: project.openclawHome,
      OPENCLAW_CONFIG_PATH: configPath,
    });
    checks.push("openclaw config validate passed");
  } catch (error) {
    warnings.push(
      `openclaw config validate failed before apply: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { project, warnings, checks };
}
