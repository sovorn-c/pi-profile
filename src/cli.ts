#!/usr/bin/env node
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
  runPi,
  setDefaultProfile,
  shellHelpers,
  showProfile,
} from "./core.js";

const VERSION = (
  JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

// Pi subcommands that can be run directly against the default profile without
// an explicit profile name. `list` is intentionally excluded because
// `pi-profile list` already lists profiles.
const PI_SUBCOMMANDS = new Set(["install", "remove", "config"]);

function usage(): string {
  return `Usage:
  pi-profile <profile> [...pi args]
  pi-profile [default profile args]
  pi-profile create <name> [--template coding|research|personal|blank] [--from <profile>] [--from-base] [--clone-all] [--workspace <dir>] [--description <text>] [--no-memory] [--own-auth] [--own-models] [--json]
  pi-profile list [--json]
  pi-profile show <name> [--json]
  pi-profile dir <name> [--json]
  pi-profile resources <name> [--json]
  pi-profile doctor <name> [--json]
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
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
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
    const unknownArg = args.find((arg) => arg.startsWith("-"));
    if (unknownArg) throw new Error(`Unknown create argument: ${unknownArg}`);
    if (args.length > 1) throw new Error(`Unexpected extra profile name: ${args[1]}`);
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
    const from = valueAfter(rest, "--from", undefined);
    print(
      json
        ? result
        : `Created profile ${result.name} at ${result.dir}\nConfiguration: inherited from ${from ? `profile ${from}` : "main Pi"}\nTemplate: ${result.template}\nMemory: ${result.memory ? "enabled" : "disabled"}\nAuth: ${result.auth}\nModels: ${result.models}`,
      json,
    );
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

  if (cmd === "resources") {
    const name = rest.find((arg) => arg !== "--json");
    const { profileResources } = await import("./core.js");
    const result = profileResources(name, { home });
    print(result, json);
    return 0;
  }

  if (cmd === "doctor") {
    const name = rest.find((arg) => arg !== "--json");
    const { profileDoctor } = await import("./core.js");
    const result = profileDoctor(name, { home });
    if (json) {
      print(result, true);
    } else {
      const status = result.ok ? "ok" : "issues found";
      console.log(`Profile: ${result.name}\nStatus: ${status}\n`);
      if (result.issues.length === 0) {
        console.log("No issues detected.");
      } else {
        for (const issue of result.issues) {
          const prefix = issue.severity.toUpperCase();
          const pathSuffix = issue.path ? `\n  ${issue.path}` : "";
          console.log(`[${prefix}] ${issue.message}${pathSuffix}`);
        }
      }
    }
    return result.ok ? 0 : 1;
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

  // Pi subcommands against the default profile: `pi-profile install npm:foo`
  if (cmd && PI_SUBCOMMANDS.has(cmd)) {
    const spec = launchSpec(undefined, argv, { home, env: process.env });
    return runPi(spec);
  }

  const usesDefaultProfile = !cmd || cmd.startsWith("-");
  const profileName = usesDefaultProfile ? undefined : cmd;
  const piArgs = usesDefaultProfile ? argv : rest;
  const spec = launchSpec(profileName, piArgs, { home, env: process.env });
  return runPi(spec);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`pi-profile: ${errorMessage(error)}`);
    process.exit(1);
  });
