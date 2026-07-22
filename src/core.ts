import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crossSpawn from "cross-spawn";

export const RESERVED_NAMES = new Set([
  "create",
  "list",
  "dir",
  "delete",
  "default",
  "current",
  "shell",
  "show",
  "resources",
  "doctor",
  "install",
  "remove",
  "config",
  "update",
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

// Keep the default profile lightweight: copy native configuration and loose
// resources, while allowing Pi to restore package-managed resources declared in
// settings.json on first launch instead of duplicating npm/git installations.
const BASE_OPERATIONAL_ENTRIES = [
  "settings.json",
  "keybindings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "tools",
  "bin",
] as const;

const IDENTITY_FILES = ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md"] as const;
const PROFILE_CONFIGURATION_ENTRIES = [...BASE_OPERATIONAL_ENTRIES, ...IDENTITY_FILES] as const;

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
  /** Command used to materialize inherited packages. Defaults to the platform Pi executable. */
  piCommand?: readonly string[];
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

export interface ProfilePackage {
  source: string;
  kind: "npm" | "git";
  id: string;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export interface ProfileResources {
  name: string;
  dir: string;
  packages: {
    declared: ProfilePackage[];
    missing: ProfilePackage[];
    stale: ProfilePackage[];
  };
  extensions: {
    loose: string[];
    looseDirs: string[];
    configOnly: string[];
  };
  skills: string[];
  prompts: string[];
  themes: string[];
  tools: string[];
}

export interface DoctorIssue {
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function writeFileIfMissing(file: string, content: string, mode?: number): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, mode === undefined ? undefined : { mode });
}

function copyFileIfMissing(source: fs.PathLike, destination: string): void {
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
}

function ensureProfileSettings(settingsDir: string, profileDir: string): void {
  const file = path.join(settingsDir, "settings.json");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...SETTINGS, sessionDir: path.join(profileDir, "sessions") }, null, 2)}\n`,
    );
    return;
  }
  let settings: Record<string, unknown>;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    settings = value as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid settings.json inherited from ${file}`);
  }
  // Use an absolute path so sessions stay inside the profile regardless of the
  // workspace or current working directory Pi is launched from.
  settings.sessionDir = path.join(profileDir, "sessions");
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function copyPath(source: string, target: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), target);
  } else if (stat.isDirectory()) {
    copyTree(source, target);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    copyPath(path.join(src, entry), path.join(dest, entry));
  }
}

function copySelectedEntries(source: string, destination: string, entries: readonly string[]): void {
  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(destination, entry);
    const stat = fs.lstatSync(sourcePath);
    // Materialize selected top-level links so profile setup and later edits cannot
    // write through a linked extensions/skills directory into the source profile.
    if (stat.isSymbolicLink()) {
      const targetStat = fs.statSync(sourcePath);
      if (targetStat.isDirectory()) copyTree(fs.realpathSync(sourcePath), targetPath);
      else fs.copyFileSync(sourcePath, targetPath);
    } else {
      copyPath(sourcePath, targetPath);
    }
  }
}

function packageEntrySource(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const source = (entry as Record<string, unknown>).source;
    return typeof source === "string" ? source : null;
  }
  return null;
}

function isRemotePackageSource(source: string): boolean {
  const value = source.trim();
  return (
    value.startsWith("npm:") ||
    value.startsWith("git:") ||
    value.startsWith("http:") ||
    value.startsWith("https:") ||
    value.startsWith("ssh:")
  );
}

function rebaseInheritedLocalPackages(settingsDir: string, sourceDir: string): void {
  const settings = readSettings(settingsDir);
  if (!settings || !Array.isArray(settings.packages)) return;

  let changed = false;
  settings.packages = settings.packages.map((entry) => {
    const source = packageEntrySource(entry);
    if (!source) return entry;
    const value = source.trim();
    const isHomeRelative = value === "~" || value.startsWith("~/") || value.startsWith("~\\");
    if (
      isRemotePackageSource(value) ||
      value.startsWith("file:") ||
      isHomeRelative ||
      path.isAbsolute(value) ||
      path.win32.isAbsolute(value)
    ) {
      return entry;
    }
    changed = true;
    const absoluteSource = path.resolve(sourceDir, value);
    return typeof entry === "string"
      ? absoluteSource
      : { ...(entry as Record<string, unknown>), source: absoluteSource };
  });

  if (changed) {
    fs.writeFileSync(path.join(settingsDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  }
}

function inheritedManagedPackageSources(dir: string): string[] {
  const settings = readSettings(dir);
  if (!settings || !Array.isArray(settings.packages)) return [];

  const sources = settings.packages
    .map(packageEntrySource)
    .filter((source): source is string => source !== null)
    .filter(isRemotePackageSource);

  return [...new Set(sources)];
}

function redactPackageOutput(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, "$1***@")
    .replace(/([?&](?:access_token|auth|key|password|token)=)[^&\s]+/gi, "$1***");
}

function materializeInheritedPackages(dir: string, piCommand?: readonly string[]): void {
  const sources = inheritedManagedPackageSources(dir);
  if (sources.length === 0) return;
  const effectiveCommand = piCommand ?? [process.platform === "win32" ? "pi.cmd" : "pi"];
  if (effectiveCommand.length === 0) throw new Error("Pi command cannot be empty");

  const [command, ...commandArgs] = effectiveCommand;
  for (const source of sources) {
    const result = crossSpawn.sync(command, [...commandArgs, "install", source], {
      cwd: dir,
      env: { ...process.env, PI_CODING_AGENT_DIR: dir },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const safeSource = redactPackageOutput(source);
    if (result.error) {
      throw new Error(
        `Could not materialize inherited package ${safeSource}: ${redactPackageOutput(result.error.message)}`,
      );
    }
    if (result.status !== 0) {
      const detail = redactPackageOutput(`${result.stderr || ""}\n${result.stdout || ""}`.trim());
      throw new Error(
        `Could not materialize inherited package ${safeSource}${detail ? `: ${detail}` : ""}`,
      );
    }
  }
}

function applyTemplate(dir: string, templateName: TemplateName): void {
  for (const file of IDENTITY_FILES) fs.rmSync(path.join(dir, file), { force: true });
  if (templateName === "blank") return;
  const template = TEMPLATES[templateName];
  fs.writeFileSync(path.join(dir, "AGENTS.md"), template.agents);
  fs.writeFileSync(path.join(dir, "APPEND_SYSTEM.md"), template.append);
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
  if (opts.cloneAll && !opts.from && !opts.fromBase) {
    throw new Error("--clone-all requires --from or --from-base");
  }
  if (opts.workspace) {
    const workspace = path.resolve(opts.workspace);
    if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
      throw new Error(`Workspace does not exist or is not a directory: ${workspace}`);
    }
  }

  const sourceProfile = opts.from ? resolveProfileArg(opts.from, { home }) : null;
  const source = sourceProfile?.dir || profilePaths.baseAgentDir;
  const sourceMetadata = sourceProfile ? readProfileMetadata(sourceProfile.name, { home }) : null;
  const requestedTemplate = opts.template || sourceMetadata?.template || "blank";
  if (!isTemplateName(requestedTemplate)) throw new Error(`Unknown template: ${requestedTemplate}`);
  const templateName = requestedTemplate;

  fs.mkdirSync(profilePaths.profilesDir, { recursive: true, mode: 0o700 });
  const stagingDir = fs.mkdtempSync(path.join(profilePaths.profilesDir, `.${name}-`));
  fs.chmodSync(stagingDir, 0o700);

  let authMode: FileMode = "skipped";
  let modelsMode: FileMode = "skipped";
  try {
    if (fs.existsSync(source)) {
      copySelectedEntries(
        source,
        stagingDir,
        sourceProfile ? PROFILE_CONFIGURATION_ENTRIES : BASE_OPERATIONAL_ENTRIES,
      );
    }

    for (const sub of ["skills", "prompts", "extensions", "tools", "themes", "sessions"]) {
      fs.mkdirSync(path.join(stagingDir, sub), { recursive: true });
    }
    ensureProfileSettings(stagingDir, dir);
    rebaseInheritedLocalPackages(stagingDir, source);
    // Explicit installs bypass Pi's legacy global npm fallback and guarantee that
    // inherited package declarations are backed by this profile's own npm/git store.
    materializeInheritedPackages(stagingDir, opts.piCommand);

    // A template is an identity overlay, not a resource bundle. Cloning another
    // profile preserves its instructions unless the user explicitly selects a
    // template; fresh profiles never inherit main Pi's identity files.
    if (opts.template) applyTemplate(stagingDir, templateName);

    if (opts.cloneAll) {
      const sourceMemory = path.join(source, "memory");
      if (fs.existsSync(sourceMemory)) copyTree(sourceMemory, path.join(stagingDir, "memory"));
    }

    const memoryExtension = path.join(stagingDir, "extensions", "pi-profile-memory.ts");
    const legacyMemoryExtension = path.join(stagingDir, "extensions", "pi-profile-memory.js");
    if (opts.memory !== false) {
      const memoryPath = path.join(stagingDir, "memory");
      fs.mkdirSync(memoryPath, { recursive: true, mode: 0o700 });
      fs.chmodSync(memoryPath, 0o700);
      for (const [file, content] of Object.entries(MEMORY_FILES)) {
        const memoryFile = path.join(memoryPath, file);
        writeFileIfMissing(memoryFile, content, 0o600);
        fs.chmodSync(memoryFile, 0o600);
      }
      fs.rmSync(legacyMemoryExtension, { force: true });
      copyFileIfMissing(MEMORY_EXTENSION_SOURCE, memoryExtension);
    } else {
      fs.rmSync(path.join(stagingDir, "memory"), { recursive: true, force: true });
      fs.rmSync(memoryExtension, { force: true });
      fs.rmSync(legacyMemoryExtension, { force: true });
    }

    const metadataOpts: CreateProfileOptions = {
      ...opts,
      description: opts.description ?? sourceMetadata?.description,
      workspace: opts.workspace ?? sourceMetadata?.workspace ?? undefined,
    };
    fs.writeFileSync(
      path.join(stagingDir, "profile.json"),
      `${JSON.stringify(profileMetadata(name, templateName, metadataOpts), null, 2)}\n`,
    );

    const authDest = path.join(stagingDir, "auth.json");
    const modelsDest = path.join(stagingDir, "models.json");
    authMode = opts.ownAuth
      ? "own"
      : linkOrCopy(path.join(profilePaths.baseAgentDir, "auth.json"), authDest);
    modelsMode = opts.ownModels
      ? "own"
      : linkOrCopy(path.join(profilePaths.baseAgentDir, "models.json"), modelsDest);
    if (opts.ownAuth && !fs.existsSync(authDest)) {
      fs.writeFileSync(authDest, "{}\n", { mode: 0o600 });
    }
    if (opts.ownModels && !fs.existsSync(modelsDest)) {
      fs.writeFileSync(modelsDest, "{}\n", { mode: 0o600 });
    }

    if (fs.existsSync(dir)) throw new Error(`Profile already exists: ${name}`);
    fs.renameSync(stagingDir, dir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

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

function readSettings(dir: string): Record<string, unknown> | null {
  const file = path.join(dir, "settings.json");
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function npmPackageId(source: string): string {
  const spec = source.slice(4);
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) return spec;
    const versionAt = spec.indexOf("@", slash + 1);
    return versionAt === -1 ? spec : spec.slice(0, versionAt);
  }
  const versionAt = spec.indexOf("@");
  return versionAt === -1 ? spec : spec.slice(0, versionAt);
}

function gitPackageId(source: string): string {
  let spec = source.trim();
  if (spec.startsWith("git:") && !spec.startsWith("git://")) spec = spec.slice(4).trim();

  let host = "";
  let repositoryPath = "";
  const sshMatch = spec.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    host = sshMatch[1];
    repositoryPath = sshMatch[2];
  } else if (/^(https?|ssh|git|git\+ssh):\/\//.test(spec)) {
    try {
      const url = new URL(spec);
      host = url.hostname;
      repositoryPath = url.pathname.replace(/^\/+/, "");
    } catch {
      return source;
    }
  } else {
    const slash = spec.indexOf("/");
    if (slash === -1) return spec;
    host = spec.slice(0, slash);
    repositoryPath = spec.slice(slash + 1);
  }

  const refAt = repositoryPath.indexOf("@");
  if (refAt !== -1) repositoryPath = repositoryPath.slice(0, refAt);
  repositoryPath = repositoryPath.replace(/\.git$/, "");
  return `${host}/${repositoryPath}`;
}

function parsePackageEntry(entry: unknown): ProfilePackage | null {
  let source: string | undefined;
  let extensions: string[] | undefined;
  let skills: string[] | undefined;
  let prompts: string[] | undefined;
  let themes: string[] | undefined;

  if (typeof entry === "string") {
    source = entry;
  } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const obj = entry as Record<string, unknown>;
    if (typeof obj.source === "string") source = obj.source;
    if (Array.isArray(obj.extensions)) extensions = obj.extensions as string[];
    if (Array.isArray(obj.skills)) skills = obj.skills as string[];
    if (Array.isArray(obj.prompts)) prompts = obj.prompts as string[];
    if (Array.isArray(obj.themes)) themes = obj.themes as string[];
  }

  if (!source) return null;
  if (source.startsWith("npm:")) {
    return { source, kind: "npm", id: npmPackageId(source), extensions, skills, prompts, themes };
  }
  if (
    source.startsWith("git:") ||
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("ssh://")
  ) {
    return { source, kind: "git", id: gitPackageId(source), extensions, skills, prompts, themes };
  }
  return null;
}

function parseDeclaredPackages(dir: string): ProfilePackage[] {
  const settings = readSettings(dir);
  const packages = settings?.packages;
  if (!Array.isArray(packages)) return [];
  return packages.map(parsePackageEntry).filter((p): p is ProfilePackage => p !== null);
}

function installedNpmPackages(dir: string): string[] {
  // Prefer npm/package.json dependencies because node_modules contains every
  // transitive dependency; scanning it would report valid deps as stale.
  const packageJsonPath = path.join(dir, "npm", "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const value = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const deps = (value as Record<string, unknown>).dependencies;
        if (deps && typeof deps === "object" && !Array.isArray(deps)) {
          return Object.keys(deps).sort();
        }
      }
    } catch {
      // fall through to node_modules scan
    }
  }

  const npmDir = path.join(dir, "npm", "node_modules");
  if (!fs.existsSync(npmDir)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(npmDir)) {
    if (entry === ".bin" || entry === "package-lock.json" || entry.startsWith(".")) continue;
    const entryPath = path.join(npmDir, entry);
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      if (entry.startsWith("@")) {
        for (const sub of fs.readdirSync(entryPath)) {
          const subPath = path.join(entryPath, sub);
          if (fs.statSync(subPath).isDirectory()) {
            result.push(`${entry}/${sub}`);
          }
        }
      } else {
        result.push(entry);
      }
    }
  }
  return result.sort();
}

function installedGitPackages(dir: string): string[] {
  const gitDir = path.join(dir, "git");
  if (!fs.existsSync(gitDir)) return [];
  const result: string[] = [];

  const visit = (current: string, relativeParts: string[]): void => {
    if (fs.existsSync(path.join(current, ".git"))) {
      result.push(relativeParts.join("/"));
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      visit(path.join(current, entry.name), [...relativeParts, entry.name]);
    }
  };

  visit(gitDir, []);
  return result.sort();
}

function scanDirEntries(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function isConfigOnlyExtensionDir(dir: string, name: string): boolean {
  const extDir = path.join(dir, "extensions", name);
  if (!fs.existsSync(extDir) || !fs.statSync(extDir).isDirectory()) return false;
  const entries = fs
    .readdirSync(extDir)
    .filter((entry) => !entry.startsWith("."));
  return entries.length === 1 && entries[0] === "config.json";
}

export function profileResources(name: unknown, opts: HomeOptions = {}): ProfileResources {
  const resolved = resolveProfileArg(name, opts);
  const dir = resolved.dir;
  const declared = parseDeclaredPackages(dir);
  const declaredNpm = new Set(declared.filter((p) => p.kind === "npm").map((p) => p.id));
  const declaredGit = new Set(declared.filter((p) => p.kind === "git").map((p) => p.id));

  const installedNpm = installedNpmPackages(dir);
  const installedGit = installedGitPackages(dir);

  const missing = declared.filter((p) => {
    if (p.kind === "npm") return !installedNpm.includes(p.id);
    return !installedGit.includes(p.id);
  });

  const stale: ProfilePackage[] = [];
  for (const id of installedNpm) {
    if (!declaredNpm.has(id)) {
      stale.push({ source: `npm:${id}`, kind: "npm", id });
    }
  }
  for (const id of installedGit) {
    if (!declaredGit.has(id)) {
      stale.push({ source: `git:${id}`, kind: "git", id });
    }
  }

  const extensionEntries = scanDirEntries(path.join(dir, "extensions"));
  const loose: string[] = [];
  const looseDirs: string[] = [];
  const configOnly: string[] = [];
  for (const entry of extensionEntries) {
    const entryPath = path.join(dir, "extensions", entry);
    const stat = fs.statSync(entryPath);
    if (stat.isFile()) {
      loose.push(entry);
    } else if (stat.isDirectory()) {
      if (isConfigOnlyExtensionDir(dir, entry)) {
        configOnly.push(entry);
      } else {
        looseDirs.push(entry);
      }
    }
  }

  return {
    name: resolved.name,
    dir,
    packages: {
      declared,
      missing,
      stale,
    },
    extensions: { loose, looseDirs, configOnly },
    skills: scanDirEntries(path.join(dir, "skills")),
    prompts: scanDirEntries(path.join(dir, "prompts")),
    themes: scanDirEntries(path.join(dir, "themes")),
    tools: scanDirEntries(path.join(dir, "tools")),
  };
}

export interface DoctorResult {
  name: string;
  dir: string;
  ok: boolean;
  issues: DoctorIssue[];
}

export function profileDoctor(name: unknown, opts: HomeOptions = {}): DoctorResult {
  const resolved = resolveProfileArg(name, opts);
  const dir = resolved.dir;
  const issues: DoctorIssue[] = [];

  const settings = readSettings(dir);
  if (!settings) {
    issues.push({
      severity: "error",
      message: "settings.json is missing or invalid JSON",
      path: path.join(dir, "settings.json"),
    });
  } else if (!Array.isArray(settings.packages) && !("packages" in settings)) {
    issues.push({
      severity: "info",
      message: "settings.json has no packages array; profile has no declared Pi packages",
      path: path.join(dir, "settings.json"),
    });
  }

  let resources: ProfileResources;
  try {
    resources = profileResources(name, opts);
  } catch (error) {
    issues.push({
      severity: "error",
      message: `Could not scan profile resources: ${errorMessage(error)}`,
    });
    return { name: resolved.name, dir, ok: false, issues };
  }

  for (const pkg of resources.packages.missing) {
    issues.push({
      severity: "error",
      message: `Declared package is not installed: ${pkg.source}`,
      path: pkg.kind === "npm" ? path.join(dir, "npm", "package.json") : path.join(dir, "git", pkg.id),
    });
  }

  for (const pkg of resources.packages.stale) {
    issues.push({
      severity: "warning",
      message: `Installed package is not declared in settings.json: ${pkg.source}`,
      path: pkg.kind === "npm" ? path.join(dir, "npm", "package.json") : path.join(dir, "git", pkg.id),
    });
  }

  for (const ext of resources.extensions.configOnly) {
    issues.push({
      severity: "info",
      message: `Configuration-only extension directory: ${ext}`,
      path: path.join(dir, "extensions", ext),
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return { name: resolved.name, dir, ok: !hasErrors, issues };
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

export function runPi(spec: LaunchSpec): Promise<number> {
  const child = spawn(spec.command, spec.args, {
    stdio: "inherit",
    env: spec.env,
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
  });
  return new Promise<number>((resolve) => {
    child.on("error", (error) => {
      console.error(error.message);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      resolve(code ?? 1);
    });
  });
}
