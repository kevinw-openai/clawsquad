import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { initProject } from "../src/core/init.js";
import { loadProject } from "../src/core/project.js";

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

test("initProject copies the built-in example-team template", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-init-"));
  try {
    const written = await initProject(tempDir);
    assert.ok(written.some((file) => file.endsWith("clawsquad.json")));

    const project = await loadProject(tempDir);
    assert.equal(project.manifest.name, "example-team");
    assert.equal(project.manifest.roles.length, 2);
    assert.equal(project.openclawHome, path.join(os.homedir(), ".openclaw"));
    assert.equal(project.renderedRoot, path.join(tempDir, ".clawsquad/rendered"));

    const roleIds = project.roles.map((role) => role.manifest.id);
    assert.deepEqual(roleIds, ["lead", "developer"]);

    const lead = project.roles[0];
    assert.equal(lead.targetWorkspaceRel, "workspace-lead");
    assert.equal(lead.targetWorkspaceAbs, path.join(project.openclawHome, "workspace-lead"));
    assert.equal(lead.targetAgentDirRel, "agents/lead/agent");
    assert.equal(lead.targetAgentDirAbs, path.join(project.openclawHome, "agents/lead/agent"));

    const developer = project.roles[1];
    assert.equal(developer.targetWorkspaceRel, "workspace-developer");
    assert.equal(developer.targetAgentDirRel, "agents/developer/agent");
    assert.equal(
      developer.targetAgentDirAbs,
      path.join(project.openclawHome, "agents/developer/agent"),
    );

    const leadTemplate = await readFile(
      path.join(tempDir, "roles/lead/AGENTS.template.md"),
      "utf8",
    );
    const developerTemplate = await readFile(
      path.join(tempDir, "roles/developer/AGENTS.template.md"),
      "utf8",
    );
    assert.match(leadTemplate, /single point of contact/i);
    assert.match(developerTemplate, /self-QA/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("initProject can copy a custom template directory", async () => {
  const templateDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-template-"));
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-init-custom-"));
  try {
    await writeJson(path.join(templateDir, "clawsquad.json"), {
      name: "custom-team",
      roles: [
        {
          id: "solo",
          templatesDir: "./roles/solo",
          agentDir: null,
        },
      ],
    });
    await mkdir(path.join(templateDir, "roles/solo"), { recursive: true });
    await writeFile(path.join(templateDir, "roles/solo/AGENTS.template.md"), "# Solo\n", "utf8");
    await writeFile(path.join(templateDir, "roles/solo/SOUL.template.md"), "# Soul\n", "utf8");
    await writeFile(path.join(templateDir, "roles/solo/USER.template.md"), "# User\n", "utf8");

    const written = await initProject(targetDir, { template: templateDir });
    assert.ok(written.some((file) => file.endsWith("roles/solo/AGENTS.template.md")));

    const project = await loadProject(targetDir);
    assert.equal(project.manifest.name, "custom-team");
    assert.equal(project.roles[0]?.targetWorkspaceRel, "workspace-solo");
    assert.equal(project.roles[0]?.targetAgentDirAbs, undefined);
  } finally {
    await rm(templateDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("initProject refuses to overwrite an existing scaffold without force", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-init-force-"));
  try {
    await initProject(tempDir);
    await assert.rejects(() => initProject(tempDir), /Project already exists/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
