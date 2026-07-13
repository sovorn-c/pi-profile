# pi-profile

[![npm version](https://img.shields.io/npm/v/%40sovorn%2Fpi-profile?logo=npm&label=npm)](https://www.npmjs.com/package/@sovorn/pi-profile)
[![Pi package](https://img.shields.io/badge/Pi-package-6C5CE7)](https://pi.dev/packages/@sovorn/pi-profile)
[![MIT license](https://img.shields.io/npm/l/%40sovorn%2Fpi-profile)](LICENSE)

Hermes-style isolated profiles for the [Pi coding agent](https://pi.dev), with profile-local configuration, instructions, sessions, resources, and persistent memory.

**Package listings:** [npm](https://www.npmjs.com/package/@sovorn/pi-profile) · [Pi package directory](https://pi.dev/packages/@sovorn/pi-profile)

`pi-profile` is a small launcher around Pi's documented `PI_CODING_AGENT_DIR`. Each profile is a complete Pi agent home under `~/.pi/profiles/<name>`; launching a profile starts Pi against that directory without modifying Pi itself.

## Why profiles?

Use profiles when separate agent identities should not mix state:

- a coding agent and a research agent with different instructions;
- work and personal environments with different credentials;
- agents with different models, extensions, skills, prompts, and themes;
- independent session history and durable memory.

A profile is **not** a workspace or a sandbox. It controls Pi configuration and state. Tool commands still run in the launch directory unless the profile has an explicit workspace, and the process retains the same filesystem permissions as your user.

## Install

Install the launcher globally:

```bash
npm install -g @sovorn/pi-profile
```

The package also contains a Pi skill so agents can explain and operate the CLI. Install that package resource with:

```bash
pi install npm:@sovorn/pi-profile
```

Installing through Pi does not replace the global CLI installation above.

Requirements: Node.js 18+ and the `pi` executable available on `PATH`.

## Quick start

```bash
# Create an isolated profile with persistent memory
pi-profile create coder

# Add an opinionated instruction template
pi-profile create researcher --template research

# Inspect and select a default
pi-profile list
pi-profile show coder
pi-profile default coder

# Start Pi
pi-profile coder
pi-profile                       # starts the default profile
pi-profile researcher -p "Research this repository"
```

Launching `coder` is equivalent to:

```bash
PI_CODING_AGENT_DIR="$HOME/.pi/profiles/coder" pi
```

Pi chooses its agent directory during startup. Profiles therefore cannot be switched inside an already-running Pi process; exit and launch the other profile instead.

## What a profile contains

```text
~/.pi/profiles/coder/
├── profile.json                 # pi-profile metadata
├── settings.json                # native Pi settings
├── auth.json                    # shared symlink or private file
├── models.json                  # shared symlink or private file
├── AGENTS.md                    # present when a persona template is used
├── APPEND_SYSTEM.md             # present when a persona template is used
├── extensions/
│   └── pi-profile-memory.ts     # typed persistent-memory integration
├── skills/
├── prompts/
├── themes/
├── tools/
├── sessions/
└── memory/
    ├── USER.md                  # durable user preferences
    ├── HINDSIGHT.md             # reusable outcomes and lessons
    └── FAILURES.md              # recurring failure modes
```

The default profile is intentionally blank in personality: it receives native Pi directories and memory, but no `AGENTS.md` or `APPEND_SYSTEM.md`. Choose `--template coding`, `research`, or `personal` to seed profile-specific instructions.

## Persistent memory

Memory is implemented by the generated TypeScript extension at `extensions/pi-profile-memory.ts`, not merely by creating Markdown files. For the active profile, it:

- injects bounded context from `USER.md`, `HINDSIGHT.md`, and `FAILURES.md`;
- gives the agent a `profile_memory` tool for classifying durable preferences, reusable lessons, and recurring failures;
- appends a bounded outcome only after the agent has fully settled, avoiding intermediate retry output;
- compacts oversized memory files and suppresses exact duplicates;
- exposes `/memory` for inspecting the active profile's memory;
- stores everything below the active `PI_CODING_AGENT_DIR`, keeping profiles separate.

The memory system does not create or update skills. The files remain ordinary Markdown, so users can review, edit, or delete entries directly. Create a profile without memory using:

```bash
pi-profile create clean --no-memory
```

## Templates

```bash
pi-profile create coder --template coding
pi-profile create researcher --template research
pi-profile create assistant --template personal
pi-profile create clean --template blank
```

Templates only seed instruction files. Pi's native `AGENTS.md` and `APPEND_SYSTEM.md` loading gives those files behavior.

## Clone behavior

Clone configuration, instructions, and resources while starting with fresh sessions and fresh memory:

```bash
pi-profile create work --from coder
```

Copy memory too:

```bash
pi-profile create coder-backup --from coder --clone-all
```

Create from the normal `~/.pi/agent` configuration:

```bash
pi-profile create work --from-base
```

`--clone-all` copies profile memory, but session history remains fresh. Sessions are intentionally not copied by either mode.

## Authentication and models

When base files exist, new profiles share them by symlink:

```text
~/.pi/profiles/coder/auth.json   -> ~/.pi/agent/auth.json
~/.pi/profiles/coder/models.json -> ~/.pi/agent/models.json
```

For independent files:

```bash
pi-profile create client --own-auth --own-models
pi-profile client /login
```

`--own-auth` and `--own-models` create empty profile-local JSON files.

## Workspace

Profiles normally preserve the directory from which `pi-profile` is launched. To bind a profile to one project:

```bash
pi-profile create project-agent --workspace /absolute/path/to/project
```

The launcher starts Pi in that directory. This is convenience, not filesystem isolation.

## Commands

```text
pi-profile <profile> [...pi args]
pi-profile [default-profile pi args]

pi-profile create <name>
  [--template coding|research|personal|blank]
  [--from <profile>] [--from-base] [--clone-all]
  [--workspace <directory>]
  [--description <text>] [--label <text>]
  [--no-memory] [--own-auth] [--own-models] [--json]

pi-profile list [--json]
pi-profile show <name> [--json]
pi-profile dir <name> [--json]
pi-profile default [<name>] [--json]
pi-profile current [--json]
pi-profile delete <name> --force [--json]
pi-profile shell
pi-profile --version
```

If the first launch argument begins with `-`, it is forwarded to Pi and the configured default profile is used:

```bash
pi-profile -p "Summarize this repository"
```

`pi-profile shell` prints optional shell helper functions such as `pi_coder`.

## JSON output

Management commands support machine-readable output:

```bash
pi-profile list --json
pi-profile show coder --json
pi-profile current --json
pi-profile dir coder --json
```

## Development

The CLI, core library, tests, and generated Pi extension are maintained in TypeScript:

```text
src/                    # CLI and profile-management source
templates/extensions/   # profile-local Pi extension source
test/                   # TypeScript test suite
dist/                   # generated JavaScript runtime (not committed)
```

```bash
npm install
npm run typecheck
npm test
npm run build
```

Node executes the compiled `dist/cli.js` runtime published to npm, while Pi loads the generated `pi-profile-memory.ts` extension directly.

## License

[MIT](LICENSE)
