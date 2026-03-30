import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeManagedBindingsIntoConfig,
  mergeRolesIntoConfig,
  type OpenClawConfig,
} from "../src/core/openclaw.js";
import type { LoadedRole } from "../src/core/types.js";

function makeRole(overrides: Partial<LoadedRole>): LoadedRole {
  return {
    manifest: {
      id: overrides.manifest?.id ?? "main",
      name: overrides.manifest?.name,
      description: overrides.manifest?.description,
      templatesDir: overrides.manifest?.templatesDir ?? "./roles/main",
      varsFile: overrides.manifest?.varsFile,
      workspaceDir: overrides.manifest?.workspaceDir,
      agentDir: overrides.manifest?.agentDir,
      subagents: overrides.manifest?.subagents,
      bindings: overrides.manifest?.bindings,
      runtime: overrides.manifest?.runtime,
    },
    templatesDir: overrides.templatesDir ?? "/tmp/templates",
    roleVars: overrides.roleVars ?? {},
    renderedDir: overrides.renderedDir ?? "/tmp/rendered",
    targetWorkspaceRel: overrides.targetWorkspaceRel ?? "workspace",
    targetWorkspaceAbs: overrides.targetWorkspaceAbs ?? "/tmp/openclaw/workspace",
    targetAgentDirRel: overrides.targetAgentDirRel,
    targetAgentDirAbs: overrides.targetAgentDirAbs,
  };
}

test("mergeRolesIntoConfig updates matching agents and preserves unrelated fields", () => {
  const config: OpenClawConfig = {
    keep: true,
    agents: {
      defaults: {
        theme: "dark",
      },
      list: [
        {
          id: "main",
          name: "Old Name",
          extra: {
            keep: true,
          },
          tools: {
            profile: "legacy",
            keep: "yes",
          },
          subagents: {
            allowAgents: ["old"],
            keep: "yes",
          },
        },
      ],
    },
  };

  const mainRole = makeRole({
    manifest: {
      id: "main",
      name: "Main Planner",
      runtime: {
        model: "openai-codex/gpt-5.4",
        toolsProfile: "coding",
      },
      subagents: ["manager", "developer"],
    },
    targetWorkspaceAbs: "/tmp/openclaw/workspace",
    targetAgentDirAbs: "/tmp/openclaw/agents/main/agent",
  });
  const developerRole = makeRole({
    manifest: {
      id: "developer",
      runtime: {
        model: "openai-codex/gpt-5.4-mini",
      },
    },
    targetWorkspaceAbs: "/tmp/openclaw/workspace-developer",
    targetAgentDirAbs: "/tmp/openclaw/agents/developer/agent",
  });

  const next = mergeRolesIntoConfig(config, [mainRole, developerRole]);

  assert.notEqual(next, config);
  assert.deepEqual(config.agents?.list?.[0], {
    id: "main",
    name: "Old Name",
    extra: {
      keep: true,
    },
    tools: {
      profile: "legacy",
      keep: "yes",
    },
    subagents: {
      allowAgents: ["old"],
      keep: "yes",
    },
  });

  assert.equal(next.keep, true);
  assert.deepEqual(next.agents?.defaults, { theme: "dark" });
  assert.equal(next.agents?.list?.length, 2);
  assert.deepEqual(next.agents?.list?.[0], {
    id: "main",
    name: "Main Planner",
    extra: {
      keep: true,
    },
    tools: {
      profile: "coding",
      keep: "yes",
    },
    subagents: {
      allowAgents: ["manager", "developer"],
      keep: "yes",
    },
    workspace: "/tmp/openclaw/workspace",
    agentDir: "/tmp/openclaw/agents/main/agent",
    model: "openai-codex/gpt-5.4",
  });
  assert.deepEqual(next.agents?.list?.[1], {
    id: "developer",
    workspace: "/tmp/openclaw/workspace-developer",
    agentDir: "/tmp/openclaw/agents/developer/agent",
    model: "openai-codex/gpt-5.4-mini",
  });
});

test("mergeRolesIntoConfig clears agentDir when a role opts out and honors an explicit empty subagent list", () => {
  const config: OpenClawConfig = {
    agents: {
      list: [
        {
          id: "main",
          agentDir: "/tmp/openclaw/agents/main/agent",
          subagents: {
            allowAgents: ["developer"],
            keep: "yes",
          },
        },
      ],
    },
  };

  const mainRole = makeRole({
    manifest: {
      id: "main",
      subagents: [],
    },
    targetWorkspaceAbs: "/tmp/openclaw/workspace",
    targetAgentDirAbs: undefined,
  });

  const next = mergeRolesIntoConfig(config, [mainRole]);
  assert.deepEqual(next.agents?.list?.[0], {
    id: "main",
    workspace: "/tmp/openclaw/workspace",
    subagents: {
      allowAgents: [],
      keep: "yes",
    },
  });
});

test("mergeManagedBindingsIntoConfig replaces previously managed bindings with the current manifest", () => {
  const config: OpenClawConfig = {
    bindings: [
      {
        agentId: "main",
        match: {
          channel: "discord",
          peer: { kind: "direct", id: "old-user" },
        },
      },
      {
        agentId: "manual-agent",
        comment: "keep me",
        match: {
          channel: "discord",
          peer: { kind: "direct", id: "manual-user" },
        },
      },
    ],
  };

  const mainRole = makeRole({
    manifest: {
      id: "main",
      bindings: [
        {
          comment: "squad-managed",
          match: {
            channel: "discord",
            peer: { kind: "direct", id: "new-user" },
          },
        },
      ],
    },
  });

  const result = mergeManagedBindingsIntoConfig(config, [mainRole], {
    version: 1,
    managedBindingKeys: [
      JSON.stringify({
        type: "route",
        agentId: "main",
        comment: "",
        match: {
          channel: "discord",
          accountId: "",
          peerKind: "direct",
          peerId: "old-user",
          guildId: "",
          teamId: "",
          roles: [],
        },
        acp: {
          mode: "",
          label: "",
          cwd: "",
          backend: "",
        },
      }),
    ],
  });

  assert.deepEqual(result.config.bindings, [
    {
      agentId: "manual-agent",
      comment: "keep me",
      match: {
        channel: "discord",
        peer: { kind: "direct", id: "manual-user" },
      },
    },
    {
      agentId: "main",
      comment: "squad-managed",
      match: {
        channel: "discord",
        peer: { kind: "direct", id: "new-user" },
      },
    },
  ]);
  assert.equal(result.state.version, 1);
  assert.equal(result.state.managedBindingKeys.length, 1);
});
