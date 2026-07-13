#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  createProfile,
  currentProfile,
  deleteProfile,
  getDefaultProfile,
  homeDir,
  launchSpec,
  listProfiles,
  profileDir,
  setDefaultProfile,
  shellHelpers,
  showProfile,
} from "./core.js";

const VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

function usage(): string {
  return `Usage:
  pi-profile <profile> [...pi args]
  pi-profile [default profile args]
  pi-profile create <name> [--template coding|research|personal|blank] [--from <profile>] [--from-base] [--clone-all] [--workspace <dir>] [--description <text>] [--no-memory] [--own-auth] [--own-models] [--json]
  pi-profile list [--json]
  pi-profile show <name> [--json]
  pi-profile dir <name> [--json]
  pi-profile delete <name> --force [--json]
  pi-profile default <name> [--json]
  pi-profile current [--json]
  pi-profile shell
`;
}

function has(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function valueAfter(
  args: string[],
  flag: string,
  fallback: string | undefined,
): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function stripKnown(args: string[], known: Set<string>): string[] {
  const valueFlags = new Set(["--template", "--from", "--workspace", "--description", "--label"]);
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (known.has(arg)) {
      if (valueFlags.has(arg)) index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function print(data: unknown, json = false): void {
  if (json) console.log(JSON.stringify(data, null, 2));
  else if (typeof data === "string") console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(argv: string[]): Promise<number> {
  const home = homeDir(process.env);
  const [cmd, ...rest] = argv;
  const json = has(argv, "--json");

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(usage());
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return 0;
  }

  if (cmd === "create") {
    const args = stripKnown(
      rest,
      new Set([
        "--template",
        "--from",
        "--from-base",
        "--clone-all",
        "--workspace",
        "--description",
        "--label",
        "--no-memory",
        "--own-auth",
        "--own-models",
        "--json",
      ]),
    );
    const result = createProfile(args[0], {
      home,
      template: valueAfter(rest, "--template", undefined),
      from: valueAfter(rest, "--from", undefined),
      fromBase: has(rest, "--from-base"),
      cloneAll: has(rest, "--clone-all"),
      workspace: valueAfter(rest, "--workspace", undefined),
      description: valueAfter(rest, "--description", undefined),
      label: valueAfter(rest, "--label", undefined),
      memory: !has(rest, "--no-memory"),
      ownAuth: has(rest, "--own-auth"),
      ownModels: has(rest, "--own-models"),
    });
    print(json ? result : `Created profile ${result.name} at ${result.dir}`, json);
    if (!json && result.auth === "own") console.log(`Run: pi-profile ${result.name} /login`);
    return 0;
  }

  if (cmd === "list") {
    const profiles = listProfiles({ home });
    print(json ? { profiles } : profiles.join("\n"), json);
    return 0;
  }

  if (cmd === "show") {
    const name = rest.find((arg) => arg !== "--json");
    const result = showProfile(name, { home });
    print(
      json
        ? result
        : `Profile: ${result.name}\nPath: ${result.dir}\nDescription: ${result.description || "(none)"}\nMemory: ${result.memory ? "enabled" : "disabled"}\nDefault: ${result.default ? "yes" : "no"}`,
      json,
    );
    return 0;
  }

  if (cmd === "dir") {
    const name = rest.find((arg) => arg !== "--json");
    const dir = profileDir(name, home);
    print(json ? { name, dir } : dir, json);
    return 0;
  }

  if (cmd === "delete") {
    const name = rest.find((arg) => arg !== "--json" && arg !== "--force");
    const result = deleteProfile(name, { home, force: has(rest, "--force") });
    print(json ? result : `Deleted profile ${result.deleted}`, json);
    return 0;
  }

  if (cmd === "default") {
    const name = rest.find((arg) => arg !== "--json");
    if (!name) {
      const defaultProfile = getDefaultProfile({ home });
      print(json ? { defaultProfile } : defaultProfile || "", json);
    } else {
      const result = setDefaultProfile(name, { home });
      print(json ? result : `Default profile: ${result.defaultProfile}`, json);
    }
    return 0;
  }

  if (cmd === "current") {
    const result = currentProfile({ home, env: process.env });
    print(json ? { current: result } : result?.name || "", json);
    return 0;
  }

  if (cmd === "shell") {
    process.stdout.write(shellHelpers({ home }));
    return 0;
  }

  const usesDefaultProfile = !cmd || cmd.startsWith("-");
  const profileName = usesDefaultProfile ? undefined : cmd;
  const piArgs = usesDefaultProfile ? argv : rest;
  const spec = launchSpec(profileName, piArgs, { home, env: process.env });
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

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`pi-profile: ${errorMessage(error)}`);
    process.exit(1);
  });
