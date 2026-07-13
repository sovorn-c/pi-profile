import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RESERVED_NAMES = new Set([
  "create",
  "list",
  "dir",
  "delete",
  "default",
  "current",
  "shell",
  "show",
  "rename",
  "export",
  "import",
  "help",
  "--help",
  "-h",
  "--version",
  "-v",
]);

const SETTINGS = {
  skills: ["skills"],
  prompts: ["prompts"],
  extensions: ["extensions"],
  themes: ["themes"],
  sessionDir: "sessions",
};

const MEMORY_FILES = {
  "USER.md": "# User Memory\n\nStore durable user preferences here. Keep entries short and actionable.\n",
  "HINDSIGHT.md":
    "# Hindsight\n\nStore durable lessons learned after tasks. Keep entries short, actionable, and reusable.\n",
  "FAILURES.md": "# Failures\n\nRecord recurring failure modes and how to avoid them.\n",
};

const MEMORY_EXTENSION_SOURCE = new URL(
  "../templates/extensions/pi-profile-memory.ts",
  import.meta.url,
);

const TEMPLATES = {
  blank: { agents: "", append: "" },
  coding: {
    agents:
      "# AGENTS.md\n\nYou are a focused coding agent.\n\nPreferences:\n- Read existing code before editing.\n- Prefer small, targeted diffs.\n- Follow repository conventions.\n- Run relevant tests when practical.\n- Report blockers directly.\n",
    append:
      "# APPEND_SYSTEM.md\n\nPrioritize correctness, concise communication, and safe filesystem changes.\n",
  },
  research: {
    agents:
      "# AGENTS.md\n\nYou are a careful research agent.\n\nPreferences:\n- Separate facts from assumptions.\n- Cite sources or file paths when possible.\n- Summarize findings clearly.\n- Avoid changing files unless explicitly asked.\n",
    append:
      "# APPEND_SYSTEM.md\n\nBe precise about uncertainty and provenance.\n",
  },
  personal: {
    agents:
      "# AGENTS.md\n\nYou are a personal assistant profile for Pi.\n\nPreferences:\n- Be practical and direct.\n- Remember stable preferences in memory files when asked.\n- Ask before making broad changes.\n",
    append:
      "# APPEND_SYSTEM.md\n\nOptimize for helpfulness, privacy, and clear next steps.\n",
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export type Environment = NodeJS.ProcessEnv;

export interface ProfileMetadata {
  name: string;
  label: string;
  description: string;
  template: TemplateName;
  memory: boolean;
  workspace: string | null;
}

export interface ProfilePaths {
  home: string;
  baseAgentDir: string;
  profilesDir: string;
  defaultFile: string;
}

export interface HomeOptions {
  home?: string;
}

export interface CreateProfileOptions extends HomeOptions {
  template?: TemplateName | string;
  from?: string;
  fromBase?: boolean;
  cloneAll?: boolean;
  workspace?: string;
  description?: string;
  label?: string;
  memory?: boolean;
  ownAuth?: boolean;
  ownModels?: boolean;
}

export type FileMode = "own" | "symlink" | "copy" | "skipped";

export interface CreatedProfile {
  name: string;
  dir: string;
  template: TemplateName;
  auth: FileMode;
  models: FileMode;
  memory: boolean;
}

export interface ResolvedProfile {
  name: string;
  dir: string;
}

export interface ShowProfileResult {
  name: string;
  label: string;
  description: string | null;
  template?: TemplateName;
  memory: boolean;
  workspace?: string | null;
  dir: string;
  default: boolean;
}

export interface EnvironmentOptions extends HomeOptions {
  env?: Environment;
}

export interface LaunchOptions extends EnvironmentOptions {
  cwd?: string;
}

export interface LaunchSpec {
  command: "pi";
  args: string[];
  env: Environment;
  cwd?: string;
  profile: ResolvedProfile;
}

interface CopyTreeOptions {
  exclude?: Set<string>;
  excludeDirs?: Set<string>;
}

function isTemplateName(value: string): value is TemplateName {
  return Object.hasOwn(TEMPLATES, value);
}

export function homeDir(env: Environment = process.env): string {
  return env.PI_PROFILE_HOME || os.homedir();
}

export function paths(home = os.homedir()): ProfilePaths {
  return {
    home,
    baseAgentDir: path.join(home, ".pi", "agent"),
    profilesDir: path.join(home, ".pi", "profiles"),
    defaultFile: path.join(home, ".pi", "profiles", "default.json"),
  };
}

export function validateName(name: unknown): string {
  if (!name || typeof name !== "string") throw new Error("Profile name is required");
  if (RESERVED_NAMES.has(name)) throw new Error(`Reserved profile name: ${name}`);
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.length > 64) {
    throw new Error(`Invalid profile name: ${name}`);
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("~")) {
    throw new Error(`Invalid profile name: ${name}`);
  }
  return name;
}

export function profileDir(name: unknown, home = os.homedir()): string {
  return path.join(paths(home).profilesDir, validateName(name));
}

function ensureInside(child: string, parent: string): void {
  const rel = path.relative(parent, child);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Unsafe path outside profiles directory: ${child}`);
  }
}

function writeFileIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

function copyFileIfMissing(source: fs.PathLike, destination: string): void {
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
}

function copyTree(src: string, dest: string, options: CopyTreeOptions = {}): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (options.exclude?.has(entry.name)) continue;
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target);
    else if (entry.isDirectory()) {
      if (options.excludeDirs?.has(entry.name)) fs.mkdirSync(target, { recursive: true });
      else copyTree(source, target, options);
    } else fs.copyFileSync(source, target);
  }
}

function linkOrCopy(src: string, dest: string): FileMode {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return "skipped";
  try {
    fs.symlinkSync(src, dest);
    return "symlink";
  } catch {
    fs.copyFileSync(src, dest);
    return "copy";
  }
}

function profileMetadata(
  name: string,
  template: TemplateName,
  opts: CreateProfileOptions = {},
): ProfileMetadata {
  return {
    name,
    label: opts.label || name,
    description: opts.description || `${template} Pi profile`,
    template,
    memory: opts.memory !== false,
    workspace: opts.workspace ? path.resolve(opts.workspace) : null,
  };
}

export function readProfileMetadata(
  name: unknown,
  opts: HomeOptions = {},
): ProfileMetadata | null {
  const file = path.join(profileDir(name, opts.home || os.homedir()), "profile.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProfileMetadata;
  } catch {
    return null;
  }
}

export function createProfile(
  profileName: unknown,
  opts: CreateProfileOptions = {},
): CreatedProfile {
  const name = validateName(profileName);
  const home = opts.home || os.homedir();
  const profilePaths = paths(home);
  const dir = profileDir(name, home);
  ensureInside(dir, profilePaths.profilesDir);
  if (fs.existsSync(dir)) throw new Error(`Profile already exists: ${name}`);
  if (opts.from && opts.fromBase) throw new Error("Cannot use both --from and --from-base");

  const source = opts.from
    ? resolveProfileArg(opts.from, { home }).dir
    : opts.fromBase
      ? profilePaths.baseAgentDir
      : null;
  const sourceMetadata = opts.from ? readProfileMetadata(opts.from, { home }) : null;
  const requestedTemplate = opts.template || sourceMetadata?.template || "blank";
  if (!isTemplateName(requestedTemplate)) throw new Error(`Unknown template: ${requestedTemplate}`);
  const templateName = requestedTemplate;

  fs.mkdirSync(dir, { recursive: true });
  if (source && fs.existsSync(source)) {
    copyTree(source, dir, {
      excludeDirs: new Set(["sessions", "memory"]),
      exclude: new Set(["auth.json", "models.json", "profile.json"]),
    });
    fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
    if (opts.cloneAll) {
      const sourceMemory = path.join(source, "memory");
      if (fs.existsSync(sourceMemory)) copyTree(sourceMemory, path.join(dir, "memory"));
      const sourceProfile = path.join(source, "profile.json");
      if (fs.existsSync(sourceProfile)) fs.copyFileSync(sourceProfile, path.join(dir, "profile.json"));
    }
  }

  for (const sub of ["skills", "prompts", "extensions", "tools", "themes", "sessions"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  writeFileIfMissing(path.join(dir, "settings.json"), `${JSON.stringify(SETTINGS, null, 2)}\n`);

  if (opts.template && opts.template !== "blank" && !source) {
    const template = TEMPLATES[templateName];
    writeFileIfMissing(path.join(dir, "AGENTS.md"), template.agents);
    writeFileIfMissing(path.join(dir, "APPEND_SYSTEM.md"), template.append);
  }

  const memoryExtension = path.join(dir, "extensions", "pi-profile-memory.ts");
  const legacyMemoryExtension = path.join(dir, "extensions", "pi-profile-memory.js");
  if (opts.memory !== false) {
    fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
    for (const [file, content] of Object.entries(MEMORY_FILES)) {
      writeFileIfMissing(path.join(dir, "memory", file), content);
    }
    fs.rmSync(legacyMemoryExtension, { force: true });
    copyFileIfMissing(MEMORY_EXTENSION_SOURCE, memoryExtension);
  } else {
    fs.rmSync(path.join(dir, "memory"), { recursive: true, force: true });
    fs.rmSync(memoryExtension, { force: true });
    fs.rmSync(legacyMemoryExtension, { force: true });
  }

  const metadataOpts: CreateProfileOptions = {
    ...opts,
    description: opts.description ?? sourceMetadata?.description,
    workspace: opts.workspace ?? sourceMetadata?.workspace ?? undefined,
  };
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    `${JSON.stringify(profileMetadata(name, templateName, metadataOpts), null, 2)}\n`,
  );

  const authDest = path.join(dir, "auth.json");
  const modelsDest = path.join(dir, "models.json");
  const authMode: FileMode = opts.ownAuth
    ? "own"
    : linkOrCopy(path.join(profilePaths.baseAgentDir, "auth.json"), authDest);
  const modelsMode: FileMode = opts.ownModels
    ? "own"
    : linkOrCopy(path.join(profilePaths.baseAgentDir, "models.json"), modelsDest);
  if (opts.ownAuth && !fs.existsSync(authDest)) fs.writeFileSync(authDest, "{}\n");
  if (opts.ownModels && !fs.existsSync(modelsDest)) fs.writeFileSync(modelsDest, "{}\n");

  return {
    name,
    dir,
    template: templateName,
    auth: authMode,
    models: modelsMode,
    memory: opts.memory !== false,
  };
}

export function listProfiles(opts: HomeOptions = {}): string[] {
  const home = opts.home || os.homedir();
  const profilePaths = paths(home);
  if (!fs.existsSync(profilePaths.profilesDir)) return [];
  return fs
    .readdirSync(profilePaths.profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        validateName(name);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

export function showProfile(name: unknown, opts: HomeOptions = {}): ShowProfileResult {
  const resolved = resolveProfileArg(name, opts);
  const metadata = readProfileMetadata(name, opts);
  return {
    name: metadata?.name || resolved.name,
    label: metadata?.label || resolved.name,
    description: metadata?.description ?? null,
    ...(metadata?.template ? { template: metadata.template } : {}),
    memory: metadata?.memory ?? fs.existsSync(path.join(resolved.dir, "memory")),
    ...(metadata ? { workspace: metadata.workspace } : {}),
    dir: resolved.dir,
    default: getDefaultProfile(opts) === resolved.name,
  };
}

export function setDefaultProfile(nameValue: unknown, opts: HomeOptions = {}): { defaultProfile: string } {
  const name = validateName(nameValue);
  const home = opts.home || os.homedir();
  const profilePaths = paths(home);
  if (!fs.existsSync(profileDir(name, home))) throw new Error(`Profile does not exist: ${name}`);
  fs.mkdirSync(profilePaths.profilesDir, { recursive: true });
  fs.writeFileSync(
    profilePaths.defaultFile,
    `${JSON.stringify({ defaultProfile: name }, null, 2)}\n`,
  );
  return { defaultProfile: name };
}

export function getDefaultProfile(opts: HomeOptions = {}): string | null {
  const file = paths(opts.home || os.homedir()).defaultFile;
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      defaultProfile?: unknown;
      default?: unknown;
    };
    const value = data.defaultProfile || data.default;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function resolveProfileArg(
  name: unknown,
  opts: HomeOptions = {},
): ResolvedProfile {
  const home = opts.home || os.homedir();
  const resolved = typeof name === "string" && name ? name : getDefaultProfile({ home });
  if (!resolved) throw new Error("No profile specified and no default profile configured");
  validateName(resolved);
  const dir = profileDir(resolved, home);
  if (!fs.existsSync(dir)) throw new Error(`Profile does not exist: ${resolved}`);
  return { name: resolved, dir };
}

export function deleteProfile(
  nameValue: unknown,
  opts: HomeOptions & { force?: boolean } = {},
): { deleted: string } {
  const name = validateName(nameValue);
  if (!opts.force) throw new Error("Refusing to delete without --force");
  const home = opts.home || os.homedir();
  const profilePaths = paths(home);
  const dir = profileDir(name, home);
  ensureInside(dir, profilePaths.profilesDir);
  if (!fs.existsSync(dir)) throw new Error(`Profile does not exist: ${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  if (getDefaultProfile({ home }) === name) fs.rmSync(profilePaths.defaultFile, { force: true });
  return { deleted: name };
}

export function currentProfile(opts: EnvironmentOptions = {}): ResolvedProfile | null {
  const home = opts.home || os.homedir();
  const env = opts.env || process.env;
  const currentDir = env.PI_CODING_AGENT_DIR;
  if (!currentDir) return null;
  const profilePaths = paths(home);
  const rel = path.relative(profilePaths.profilesDir, path.resolve(currentDir));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) return null;
  try {
    validateName(rel);
  } catch {
    return null;
  }
  return { name: rel, dir: path.join(profilePaths.profilesDir, rel) };
}

export function shellHelpers(opts: HomeOptions = {}): string {
  const home = opts.home || os.homedir();
  return `${listProfiles({ home })
    .map(
      (name) =>
        `pi_${name.replace(/[^a-zA-Z0-9_]/g, "_")}() { pi-profile ${name} "$@"; }`,
    )
    .join("\n")}\n`;
}

export function launchSpec(
  name: unknown,
  piArgs: string[] = [],
  opts: LaunchOptions = {},
): LaunchSpec {
  const home = opts.home || os.homedir();
  const resolved = resolveProfileArg(name, { home });
  const metadata = readProfileMetadata(resolved.name, { home });
  const env: Environment = {
    ...(opts.env || process.env),
    PI_CODING_AGENT_DIR: resolved.dir,
  };
  const cwd = metadata?.workspace || opts.cwd;
  return {
    command: "pi",
    args: piArgs,
    env,
    ...(cwd ? { cwd } : {}),
    profile: resolved,
  };
}
