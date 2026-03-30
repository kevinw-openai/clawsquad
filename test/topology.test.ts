import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { applyProject } from "../src/core/apply.js";
import { loadProject } from "../src/core/project.js";
import { buildTopology, getTopologyArtifactPath } from "../src/core/topology.js";

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

test("buildTopology captures managers, lanes, and runtime details", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-topology-"));
  try {
    await writeJson(path.join(tempDir, "clawsquad.json"), {
      name: "topology-squad",
      description: "team description",
      openclawHome: ".openclaw",
      roles: [
        {
          id: "main",
          name: "Main",
          lane: "command",
          templatesDir: "./roles/main",
          workspaceDir: "workspace",
          subagents: ["developer", "reviewer"],
          runtime: {
            model: "openai-codex/gpt-5.4",
            toolsProfile: "coding",
          },
        },
        {
          id: "developer",
          name: "Developer",
          templatesDir: "./roles/developer",
          description: "Builds the feature",
          runtime: {
            model: "openai-codex/gpt-5.4-mini",
            toolsProfile: "coding",
          },
        },
        {
          id: "reviewer",
          name: "Reviewer",
          templatesDir: "./roles/reviewer",
          description: "Checks the evidence",
        },
      ],
    });

    for (const roleId of ["main", "developer", "reviewer"]) {
      await mkdir(path.join(tempDir, "roles", roleId), { recursive: true });
      await writeFile(path.join(tempDir, "roles", roleId, "AGENTS.template.md"), "# Agents\n", "utf8");
      await writeFile(path.join(tempDir, "roles", roleId, "SOUL.template.md"), "# Soul\n", "utf8");
      await writeFile(path.join(tempDir, "roles", roleId, "USER.template.md"), "# User\n", "utf8");
    }

    const topology = buildTopology(await loadProject(tempDir));
    assert.equal(topology.team.name, "topology-squad");
    assert.equal(topology.agents.find((agent) => agent.id === "main")?.managerId, null);
    assert.equal(topology.agents.find((agent) => agent.id === "developer")?.managerId, "main");
    assert.equal(topology.agents.find((agent) => agent.id === "reviewer")?.lane, "quality");
    assert.equal(
      topology.agents.find((agent) => agent.id === "developer")?.runtime.model,
      "openai-codex/gpt-5.4-mini",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyProject writes the topology artifact into the project runtime directory", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-topology-apply-"));
  try {
    const openclawHome = path.join(tempDir, ".openclaw");
    const templatesDir = path.join(tempDir, "roles/main");

    await writeJson(path.join(openclawHome, "openclaw.json"), {
      acp: {
        enabled: true,
      },
      agents: {
        list: [{ id: "main" }],
      },
      tools: {
        agentToAgent: {
          enabled: true,
        },
      },
    });

    await writeJson(path.join(tempDir, "clawsquad.json"), {
      name: "topology-apply",
      openclawHome,
      apply: {
        validateConfig: false,
        backupConfig: false,
        restartGateway: false,
      },
      roles: [
        {
          id: "main",
          templatesDir: "./roles/main",
          workspaceDir: "workspace",
        },
      ],
    });

    await mkdir(templatesDir, { recursive: true });
    await writeFile(path.join(templatesDir, "AGENTS.md.tpl"), "# Main\n", "utf8");
    await writeFile(path.join(templatesDir, "USER.md.tpl"), "# User\n", "utf8");
    await writeFile(path.join(templatesDir, "SOUL.md.tpl"), "# Soul\n", "utf8");

    const summary = await applyProject(tempDir);
    const artifactPath = getTopologyArtifactPath(await loadProject(tempDir));
    const topology = JSON.parse(await readFile(artifactPath, "utf8")) as {
      team: { name: string };
      agents: Array<{ id: string }>;
    };

    assert.equal(topology.team.name, "topology-apply");
    assert.deepEqual(topology.agents.map((agent) => agent.id), ["main"]);
    assert.ok(summary.updatedFiles.includes(artifactPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
