export interface SquadManifest {
  name: string;
  description?: string;
  openclawHome?: string;
  sharedVarsFile?: string;
  apply?: ApplyOptions;
  roles: SquadRoleManifest[];
}

export interface ApplyOptions {
  renderedDir?: string;
  backupConfig?: boolean;
  validateConfig?: boolean;
  restartGateway?: boolean;
}

export interface SquadRoleManifest {
  id: string;
  name?: string;
  description?: string;
  templatesDir: string;
  varsFile?: string;
  workspaceDir?: string;
  agentDir?: string | null;
  subagents?: string[];
  bindings?: SquadBindingManifest[];
  runtime?: RoleRuntime;
}

export interface SquadBindingMatch {
  channel: string;
  accountId?: string;
  peer?: {
    kind: "direct" | "group" | "channel" | "dm";
    id: string;
  };
  guildId?: string;
  teamId?: string;
  roles?: string[];
}

export interface SquadBindingManifest {
  type?: "route" | "acp";
  comment?: string;
  match: SquadBindingMatch;
  acp?: {
    mode?: "persistent" | "oneshot";
    label?: string;
    cwd?: string;
    backend?: string;
  };
}

export interface RoleRuntime {
  model?: string;
  toolsProfile?: string;
}

export interface LoadedProject {
  projectDir: string;
  manifestPath: string;
  manifest: SquadManifest;
  openclawHome: string;
  renderedRoot: string;
  sharedVars: JsonMap;
  roles: LoadedRole[];
}

export interface LoadedRole {
  manifest: SquadRoleManifest;
  templatesDir: string;
  roleVars: JsonMap;
  renderedDir: string;
  targetWorkspaceRel: string;
  targetWorkspaceAbs: string;
  targetAgentDirRel: string | undefined;
  targetAgentDirAbs: string | undefined;
}

export interface RenderedFile {
  outputPath: string;
  relativePath: string;
}

export interface RenderSummary {
  project: LoadedProject;
  filesByRole: Record<string, RenderedFile[]>;
}

export interface ApplySummary {
  project: LoadedProject;
  configPath: string;
  renderedRoles: string[];
  updatedFiles: string[];
  dryRun: boolean;
  backupPath?: string | undefined;
  sourceOpenclawHome?: string | undefined;
  dryRunSandboxRoot?: string | undefined;
  validated: boolean;
  restarted: boolean;
}

export interface DoctorSummary {
  project: LoadedProject;
  warnings: string[];
  checks: string[];
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonMap
  | JsonValue[];

export interface JsonMap {
  [key: string]: JsonValue;
}

export interface TemplateContext extends JsonMap {
  team: JsonMap;
  role: JsonMap;
  vars: JsonMap;
  openclaw: JsonMap;
  paths: JsonMap;
}
