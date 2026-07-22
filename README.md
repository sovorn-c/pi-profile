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

## Updating

`pi-profile` ships in two places: the global npm CLI launcher and the Pi package resource that provides the in-agent skill. Update both after a release from your shell, not from inside an interactive Pi session:

```bash
# Update the global launcher
npm update -g @sovorn/pi-profile

# Update the Pi package resource
pi update --extensions             # update all packages
# or
pi update npm:@sovorn/pi-profile   # update just this package
```

Verify the CLI version:

```bash
pi-profile --version
```

## Quick start

```bash
# Create an isolated profile that starts with your main Pi configuration
pi-profile create coder

# Add a focused instruction template on top of the same familiar setup
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
├── settings.json                # snapshot of main Pi settings
├── auth.json                    # shared symlink or private file
├── models.json                  # shared symlink or private file
├── AGENTS.md                    # present when an instruction template is used
├── APPEND_SYSTEM.md             # present when an instruction template is used
├── extensions/
│   └── pi-profile-memory.ts     # typed persistent-memory integration
├── skills/
├── prompts/
├── themes/
├── tools/
├── npm/                         # created when inherited npm packages exist
├── git/                         # created when inherited git packages exist
├── sessions/
└── memory/
    ├── USER.md                  # durable user preferences
    ├── HINDSIGHT.md             # reusable outcomes and lessons
    └── FAILURES.md              # recurring failure modes
```

A new profile copies the main Pi operational setup that users expect: `settings.json`, `keybindings.json`, loose extensions, skills, prompts, themes, tools, and managed binaries. The copied `sessionDir` is reset to the profile's own `sessions/` directory.

Package declarations are preserved and materialized during creation with Pi's native package manager. When those package types are declared, the profile receives its own `npm/package.json`, lockfile, `npm/node_modules`, and `git/` checkouts instead of resolving packages from main Pi or a device-global npm installation. Package downloads may use npm's shared cache, but the installed state remains profile-local. Creation may require network access and fails atomically if an inherited remote package cannot be materialized; an incomplete profile is not left behind.

Local-path Pi package declarations remain references to their external paths, matching Pi's native package semantics. They are not copied into the profile; inherited relative paths are rewritten to the equivalent absolute source path so cloning does not change their meaning.

Identity and state start fresh. Main Pi's `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, trust decisions, sessions, and memory are not inherited. The default profile is therefore familiar in capability but blank in personality. Choose `--template coding`, `research`, or `personal` to seed profile-specific instructions.

Copied settings and loose resources are independent snapshots, so users can customize or remove them inside the profile without changing main Pi. Top-level resource-directory symlinks are materialized for the same reason; symlinks nested inside a resource keep their original targets. Authentication and custom model definitions remain live-shared by default as described below.

A directory such as `extensions/<package>/` that contains only `config.json` is package configuration, not a separate extension installation.

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

Templates are intentionally small identity and workflow starting points. They only seed `AGENTS.md` and `APPEND_SYSTEM.md`; they do not install models, skills, extensions, prompts, or themes. Pi's native instruction loading gives those files behavior.

An explicitly selected template replaces cloned profile instruction files. `--template blank` clears `AGENTS.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md`. Without an explicit template, `--from <profile>` preserves that profile's instructions.

For a task-specific agent, create the closest starting point and then edit its instruction files. For example, Pi can create a `security-review` profile from the research template and tailor `AGENTS.md` with the desired review scope and output format.

## Clone behavior

Normal creation already starts from main Pi's operational configuration:

```bash
pi-profile create work
```

`--from-base` remains as an explicit equivalent for scripts and clarity:

```bash
pi-profile create work --from-base
```

Clone another profile's configuration, instructions, and resources while starting with fresh sessions and fresh memory:

```bash
pi-profile create work --from coder
```

Copy that profile's memory too:

```bash
pi-profile create coder-backup --from coder --clone-all
```

`--clone-all` requires `--from` or explicit `--from-base`. Session history is always fresh.

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

Profiles normally preserve the directory from which `pi-profile` is launched. The workspace passed at creation must already exist and be a directory. To bind a profile to one project:

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
pi-profile resources <name> [--json]
pi-profile doctor <name> [--json]
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

## Resuming sessions

Sessions are stored inside the profile's own `sessions/` directory. To resume a previous conversation, pass Pi's `--session` flag together with the session ID:

```bash
pi-profile coder --session <session-id>
```

Session IDs are the filenames (without the `.jsonl` extension) found in:

```text
~/.pi/profiles/coder/sessions/
```

Sessions are scoped to the profile, so launching a different profile and passing the same session ID will not resume that conversation.

## Running Pi commands against a profile

Because a profile is a Pi agent directory, Pi subcommands can be forwarded to it directly from the shell:

```bash
pi-profile coder list
pi-profile coder install npm:some-package
pi-profile coder remove npm:some-package
pi-profile coder config ...
```

For the configured default profile, `install`, `remove`, `config`, and `update` can be run without naming the profile:

```bash
pi-profile install npm:some-package
pi-profile remove npm:some-package
pi-profile config ...
pi-profile update --extensions
```

(`pi-profile list` without a profile name still lists profiles.)

## Inspecting and validating profiles

`pi-profile resources` reports the authoritative inventory for a profile: declared packages, loose extensions, skills, prompts, themes, tools, config-only extension directories, and installed-but-undeclared packages.

```bash
pi-profile resources coder
pi-profile resources coder --json
```

`pi-profile doctor` validates `settings.json` and reports missing or stale packages. It exits with a non-zero status when errors are found.

```bash
pi-profile doctor coder
pi-profile doctor coder --json
```

## JSON output

Management commands support machine-readable output:

```bash
pi-profile list --json
pi-profile show coder --json
pi-profile current --json
pi-profile dir coder --json
pi-profile resources coder --json
pi-profile doctor coder --json
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
