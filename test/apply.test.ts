import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { applyProject } from "../src/core/apply.js";

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

test("applyProject removes stale managed workspace files when templates are deleted", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-apply-"));
  try {
    const openclawHome = path.join(tempDir, ".openclaw");
    const templatesDir = path.join(tempDir, "roles/main");
    const workspaceDir = path.join(openclawHome, "workspace");

    await writeJson(path.join(openclawHome, "openclaw.json"), {
      agents: {
        list: [{ id: "main" }],
      },
    });

    await writeJson(path.join(tempDir, "clawsquad.json"), {
      name: "apply-squad",
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
          subagents: [],
        },
      ],
    });

    await mkdir(templatesDir, { recursive: true });
    await writeFile(path.join(templatesDir, "AGENTS.md.tpl"), "# Main\n", "utf8");
    await writeFile(path.join(templatesDir, "USER.md.tpl"), "# User\n", "utf8");
    await writeFile(path.join(templatesDir, "SOUL.md.tpl"), "# Soul\n", "utf8");
    await writeFile(path.join(templatesDir, "obsolete.txt"), "remove me\n", "utf8");

    await applyProject(tempDir);

    assert.equal(await readFile(path.join(workspaceDir, "obsolete.txt"), "utf8"), "remove me\n");

    await rm(path.join(templatesDir, "obsolete.txt"));
    await applyProject(tempDir);

    await assert.rejects(() => readFile(path.join(workspaceDir, "obsolete.txt"), "utf8"));
    const metadata = JSON.parse(
      await readFile(path.join(workspaceDir, ".clawsquad-managed.json"), "utf8"),
    ) as { managedFiles: string[] };
    assert.deepEqual(metadata.managedFiles.sort(), ["AGENTS.md", "SOUL.md", "USER.md"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyProject dry-run uses a sandbox in /tmp and leaves the source home untouched", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawsquad-apply-dryrun-"));
  let dryRunSandboxRoot: string | undefined;

  try {
    const openclawHome = path.join(tempDir, ".openclaw");
    const templatesDir = path.join(tempDir, "roles/main");
    const workspaceDir = path.join(openclawHome, "workspace");
    const workerWorkspaceDir = path.join(openclawHome, "workspace-worker01");

    await mkdir(workspaceDir, { recursive: true });
    await mkdir(workerWorkspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, "AGENTS.md"), "original main\n", "utf8");
    await writeFile(path.join(workerWorkspaceDir, "USER.md"), "original worker\n", "utf8");

    await writeJson(path.join(openclawHome, "openclaw.json"), {
      agents: {
        list: [
          { id: "main", workspace: workspaceDir },
          { id: "worker01", workspace: workerWorkspaceDir },
        ],
      },
    });

    await writeJson(path.join(tempDir, "clawsquad.json"), {
      name: "apply-dryrun-squad",
      openclawHome,
      apply: {
        validateConfig: false,
        backupConfig: false,
        restartGateway: true,
      },
      roles: [
        {
          id: "main",
          templatesDir: "./roles/main",
          workspaceDir: "workspace",
          subagents: [],
        },
      ],
    });

    await mkdir(templatesDir, { recursive: true });
    await writeFile(path.join(templatesDir, "AGENTS.md.tpl"), "# Main dry-run\n", "utf8");
    await writeFile(path.join(templatesDir, "USER.md.tpl"), "# User dry-run\n", "utf8");
    await writeFile(path.join(templatesDir, "SOUL.md.tpl"), "# Soul dry-run\n", "utf8");

    const summary = await applyProject(tempDir, { dryRun: true });
    dryRunSandboxRoot = summary.dryRunSandboxRoot;

    assert.equal(summary.dryRun, true);
    assert.equal(summary.sourceOpenclawHome, openclawHome);
    assert.ok(summary.dryRunSandboxRoot != null);
    assert.notEqual(summary.project.openclawHome, openclawHome);
    assert.equal(summary.restarted, false);

    assert.equal(await readFile(path.join(workspaceDir, "AGENTS.md"), "utf8"), "original main\n");

    const sandboxWorkspaceDir = path.join(summary.project.openclawHome, "workspace");
    assert.equal(await readFile(path.join(sandboxWorkspaceDir, "AGENTS.md"), "utf8"), "# Main dry-run\n");

    const sourceConfig = JSON.parse(
      await readFile(path.join(openclawHome, "openclaw.json"), "utf8"),
    ) as {
      agents: { list: Array<{ id: string; workspace: string }> };
    };
    assert.equal(sourceConfig.agents.list.find((entry) => entry.id === "worker01")?.workspace, workerWorkspaceDir);

    const sandboxConfig = JSON.parse(
      await readFile(path.join(summary.project.openclawHome, "openclaw.json"), "utf8"),
    ) as {
      agents: { list: Array<{ id: string; workspace: string }> };
    };
    assert.equal(
      sandboxConfig.agents.list.find((entry) => entry.id === "worker01")?.workspace,
      path.join(summary.project.openclawHome, "workspace-worker01"),
    );
    assert.equal(
      await readFile(path.join(summary.project.openclawHome, "workspace-worker01", "USER.md"), "utf8"),
      "original worker\n",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (dryRunSandboxRoot != null) {
      await rm(dryRunSandboxRoot, { recursive: true, force: true });
    }
  }
});
