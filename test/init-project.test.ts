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

test("initProject copies the default task-squad template", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-init-"));
  try {
    const written = await initProject(tempDir);
    assert.ok(written.some((file) => file.endsWith("clawsquad.json")));

    const project = await loadProject(tempDir);
    assert.equal(project.manifest.name, "task-squad");
    assert.equal(project.manifest.roles.length, 3);
    assert.equal(project.openclawHome, path.join(os.homedir(), ".openclaw"));
    assert.equal(project.renderedRoot, path.join(tempDir, ".clawsquad/rendered"));

    const roleIds = project.roles.map((role) => role.manifest.id);
    assert.deepEqual(roleIds, ["lead", "developer", "reviewer"]);

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
    const leadToolsTemplate = await readFile(
      path.join(tempDir, "roles/lead/TOOLS.template.md"),
      "utf8",
    );
    const developerTemplate = await readFile(
      path.join(tempDir, "roles/developer/AGENTS.template.md"),
      "utf8",
    );
    const reviewerTemplate = await readFile(
      path.join(tempDir, "roles/reviewer/AGENTS.template.md"),
      "utf8",
    );
    const reviewerToolsTemplate = await readFile(
      path.join(tempDir, "roles/reviewer/TOOLS.template.md"),
      "utf8",
    );
    assert.match(leadTemplate, /check completed work back against the current plan/i);
    assert.match(leadTemplate, /delegate scoped work through subagents and `clawtask`/i);
    assert.doesNotMatch(leadTemplate, /Codex through ACP/i);
    assert.match(leadTemplate, /Do not implement code changes yourself/i);
    assert.match(
      leadTemplate,
      /Do not start Codex ACP, open ACP sessions, or trigger any direct implementation run yourself/i,
    );
    assert.match(leadToolsTemplate, /deciding whether to continue, retry, or review/i);
    assert.match(leadToolsTemplate, /Do not open files to implement patches yourself/i);
    assert.match(
      leadToolsTemplate,
      /Do not launch Codex ACP, create ACP sessions, or run direct implementation commands yourself/i,
    );
    assert.match(developerTemplate, /use Codex through ACP/i);
    assert.match(developerTemplate, /If Codex through ACP will do the implementation work/i);
    assert.match(leadTemplate, /clawtask --project {{paths\.projectDir}}/i);
    assert.match(developerTemplate, /clawtask --project {{paths\.projectDir}}/i);
    assert.match(reviewerTemplate, /Send work back when evidence is insufficient/i);
    assert.match(reviewerTemplate, /Review only after the implementation task/i);
    assert.match(reviewerTemplate, /Leave an explicit `review_verdict` event/i);
    assert.match(reviewerTemplate, /Use `completed` only when the work is approved/i);
    assert.match(reviewerTemplate, /Use `failed` when changes are requested/i);
    assert.doesNotMatch(reviewerTemplate, /Codex through ACP/i);
    assert.match(reviewerToolsTemplate, /event --kind review_verdict/i);
    assert.match(reviewerToolsTemplate, /status --set completed` only for approval/i);
    assert.match(reviewerToolsTemplate, /status --set failed` for changes requested/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("initProject can still copy the example-team template explicitly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-init-example-"));
  try {
    await initProject(tempDir, { template: "example-team" });
    const project = await loadProject(tempDir);
    assert.equal(project.manifest.name, "example-team");
    assert.deepEqual(
      project.roles.map((role) => role.manifest.id),
      ["lead", "developer"],
    );
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
