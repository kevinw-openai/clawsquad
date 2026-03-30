import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";

import { renderProject } from "../src/core/render.js";

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

test("renderProject merges shared and role vars into .template.md templates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-render-"));
  try {
    await writeJson(path.join(tempDir, "clawsquad.json"), {
      name: "render-squad",
      description: "team description",
      openclawHome: ".openclaw",
      sharedVarsFile: "./vars/shared.json",
      apply: {
        renderedDir: ".clawsquad/out",
      },
      roles: [
        {
          id: "main",
          name: "Main Agent",
          templatesDir: "./roles/main",
          varsFile: "./vars/main.json",
          workspaceDir: "workspace",
          agentDir: "agents/main/agent",
          runtime: {
            model: "openai-codex/gpt-5.4",
            toolsProfile: "coding",
          },
        },
      ],
    });

    await writeJson(path.join(tempDir, "vars/shared.json"), {
      team: { label: "shared" },
      nested: {
        conflict: { left: "shared" },
      },
    });

    await writeJson(path.join(tempDir, "vars/main.json"), {
      nested: {
        conflict: { right: "role" },
      },
      greeting: "hello",
      list: ["a", "b"],
    });

    await mkdir(path.join(tempDir, "roles/main"), { recursive: true });
    await writeFile(
      path.join(tempDir, "roles/main", "AGENTS.template.md"),
      [
        "Team={{team.name}}",
        "TeamDescription={{team.description}}",
        "Role={{role.id}}/{{role.name}}",
        "Workspace={{paths.workspace}}",
        "AgentDir={{paths.agentDir}}",
        "Model={{role.model}}",
        "Tools={{role.toolsProfile}}",
        "Greeting={{vars.greeting}}",
        "Conflict={{vars.nested.conflict.left}}/{{vars.nested.conflict.right}}",
        "List={{vars.list}}",
        "OpenClaw={{openclaw.home}}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(tempDir, "roles/main", "notes.txt"), "plain file\n", "utf8");

    const summary = await renderProject(tempDir);
    const renderedDir = path.join(tempDir, ".clawsquad/out/main");
    const agentsPath = path.join(renderedDir, "AGENTS.md");
    const notesPath = path.join(renderedDir, "notes.txt");

    assert.equal(summary.filesByRole.main.length, 2);
    assert.deepEqual(
      summary.filesByRole.main.map((file) => file.relativePath),
      ["AGENTS.md", "notes.txt"],
    );

    assert.equal(
      await readFile(agentsPath, "utf8"),
      [
        "Team=render-squad",
        "TeamDescription=team description",
        "Role=main/Main Agent",
        `Workspace=${path.join(path.join(tempDir, ".openclaw"), "workspace")}`,
        `AgentDir=${path.join(path.join(tempDir, ".openclaw"), "agents/main/agent")}`,
        "Model=openai-codex/gpt-5.4",
        "Tools=coding",
        "Greeting=hello",
        "Conflict=shared/role",
        'List=["a","b"]',
        `OpenClaw=${path.join(tempDir, ".openclaw")}`,
      ].join("\n"),
    );
    assert.equal(await readFile(notesPath, "utf8"), "plain file\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("renderProject fails fast when a template token is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-render-missing-token-"));
  try {
    await writeJson(path.join(tempDir, "clawsquad.json"), {
      name: "render-squad",
      roles: [
        {
          id: "main",
          templatesDir: "./roles/main",
        },
      ],
    });

    await mkdir(path.join(tempDir, "roles/main"), { recursive: true });
    await writeFile(
      path.join(tempDir, "roles/main", "AGENTS.md.tpl"),
      "Hello {{vars.missing.value}}\n",
      "utf8",
    );

    await assert.rejects(
      () => renderProject(tempDir),
      /Failed to render AGENTS\.md\.tpl for role main: Unknown template token "vars\.missing\.value"/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
