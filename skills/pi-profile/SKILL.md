---
name: pi-profile
description: Use when the user asks about Pi profiles, isolated Pi agents, profile-specific auth/config, profile-local memory, or managing the external pi-profile CLI.
---

# pi-profile

`pi-profile` is a Hermes-style external profile launcher for Pi. It starts a new Pi process with `PI_CODING_AGENT_DIR` set to a profile directory, giving that profile its own Pi settings, resources, sessions, instructions, and memory.

New profiles work out of the box by copying main Pi's operational configuration and loose resources. Authentication and custom models are shared by default, while identity, sessions, memory, and trust start fresh. Templates only seed profile instructions.

## Critical limitation

Profiles are selected before Pi starts. You cannot switch the profile of the currently running Pi process. Tell users to exit Pi and run:

```bash
pi-profile <name>
```

## Mandatory profile scope protocol

When the user asks about or wants to change a specific profile, follow this protocol before any read, write, deletion, or package operation:

1. Confirm the active profile by reading `PI_CODING_AGENT_DIR` from the environment or by running `pi-profile current`.
2. Verify that directory resolves to `~/.pi/profiles/<expected-name>/`. If it does not, stop and tell the user which profile is actually active.
3. Restrict every operation to that profile directory. Do not inspect or modify `~/.pi/agent/`, `~/.agents/`, sibling profiles, or other global Pi state unless the user explicitly asks.
4. Use Pi's native commands for package and resource management from inside the launched profile:
   - `pi list`
   - `pi install npm:<package>`
   - `pi remove npm:<package>`
   - `pi config ...`
   Do not manually edit `settings.json` package declarations, because that leaves stale npm files, lockfiles, and configuration directories behind.
5. If you must run a single Pi command against a profile without entering an interactive session, you can either:
   - Launch the profile and run the command:
     ```bash
     pi-profile coder
     # inside Pi:
     pi list
     pi install npm:some-package
     pi remove npm:some-package
     ```
   - Or prefix with `PI_CODING_AGENT_DIR`:
     ```bash
     PI_CODING_AGENT_DIR="$HOME/.pi/profiles/coder" pi list
     ```
   - For the default profile, `pi-profile` also accepts `install`, `remove`, and `config` directly:
     ```bash
     pi-profile install npm:some-package
     pi-profile remove npm:some-package
     pi-profile config ...
     ```
6. After any mutation:
   - validate `settings.json`;
   - run `pi list` inside the profile;
   - list profile-local resources to confirm the expected change;
   - tell the user to run `/reload` in Pi if a session is active.

## Common commands

```bash
pi-profile create coder
pi-profile create researcher --template research
pi-profile create project-agent --workspace /absolute/path/to/project
pi-profile create clean --template blank --no-memory
pi-profile create work --from coder
pi-profile create backup --from coder --clone-all
pi-profile create work --from-base
pi-profile list
pi-profile show coder
pi-profile default coder
pi-profile
pi-profile coder
pi-profile researcher -p "research this codebase"
pi-profile coder /login
pi-profile current
pi-profile dir coder
pi-profile delete coder --force

# Run Pi commands against a named profile
pi-profile coder list
pi-profile coder install npm:some-package
pi-profile coder remove npm:some-package

# Run Pi package commands against the default profile
# (pi-profile list without a profile name still lists profiles)
pi-profile install npm:some-package
pi-profile remove npm:some-package

# Inspect a profile's resources and health
pi-profile resources coder
pi-profile resources coder --json
pi-profile doctor coder
pi-profile doctor coder --json

# Run one command against a profile from outside
PI_CODING_AGENT_DIR="$HOME/.pi/profiles/coder" pi list
```

## Profile contents

Profiles live under `~/.pi/profiles/<name>/` and contain a native Pi agent directory plus metadata. Normal creation copies main Pi's `settings.json`, `keybindings.json`, loose extensions, skills, prompts, themes, tools, and managed binaries. The copied session directory is reset to profile-local `sessions/`. Package declarations remain in settings so Pi can restore missing package installations when the profile launches; the first restoration may require network access.

Main Pi identity and state do not carry over: `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, trust decisions, sessions, and memory start fresh. The default template is blank in personality but has persistent memory; `coding`, `research`, and `personal` additionally seed Pi instruction files:

- copied operational settings and resource snapshots (nested symlinks retain their targets)
- shared or profile-local `auth.json` and `models.json`
- `AGENTS.md` and `APPEND_SYSTEM.md` for profile instructions
- `profile.json` for launcher metadata
- `memory/USER.md`, `HINDSIGHT.md`, and `FAILURES.md`
- `extensions/pi-profile-memory.ts`

The memory extension loads bounded profile memory into prompts, provides `profile_memory` for durable classified entries, and records a bounded outcome after the agent fully settles. It is profile-local and does not generate or update skills. Memory is copied only by `--clone-all`.

A directory such as `extensions/<package>/` that contains only `config.json` is package configuration, not a separate extension installation. Do not treat configuration-only directories as duplicate or leftover extensions.

## Task-specific profiles

When a user asks Pi to create a profile for a particular task:

1. Ask at most a few focused questions about the role, constraints, and desired output.
2. Choose `blank`, `coding`, `research`, or `personal` as the nearest instruction starting point.
3. Create the profile through `pi-profile create`.
4. Use `pi-profile dir <name>` to locate it.
5. Tailor that profile's `AGENTS.md` and, when useful, `APPEND_SYSTEM.md`. Editing these instruction files is expected customization; do not edit lifecycle metadata, auth links, or profile directories by hand.
6. Report what was inherited, what instructions were added, and how to launch the profile.

Keep task instructions concise and durable. Prefer `AGENTS.md` plus `APPEND_SYSTEM.md`; only create `SYSTEM.md` when the user explicitly wants to replace Pi's default system prompt. Templates do not install or remove extensions, skills, models, prompts, or themes. Users can customize those later from inside the launched profile with normal Pi commands such as `pi install`, `pi remove`, and `pi config`.

An explicit template replaces cloned instruction files. `--template blank` clears the cloned identity. Without an explicit template, `--from <profile>` preserves its instructions.

## Auth and models

By default, existing base credentials and custom models are shared through symlinks:

```text
~/.pi/profiles/<name>/auth.json   -> ~/.pi/agent/auth.json
~/.pi/profiles/<name>/models.json -> ~/.pi/agent/models.json
```

Use `--own-auth` or `--own-models` for profile-local empty JSON files. If a profile has its own auth, authenticate it with:

```bash
pi-profile <name> /login
```

## When helping users

- Prefer the simple path: `pi-profile create <name>` plus an optional `--template`.
- Explain that normal creation inherits main Pi's operational setup, while profile identity and state start fresh.
- Prefer `pi-profile list --json`, `pi-profile show <name> --json`, and `pi-profile current --json` for machine-readable output.
- Use the CLI for lifecycle operations rather than creating, renaming, or deleting directories manually. Editing a created profile's instruction files is supported customization.
- Keep `--from`, `--clone-all`, `--own-auth`, and `--own-models` for users who explicitly need advanced behavior.
- Explain that profiles isolate Pi state, not workspace filesystem access or sandbox permissions.
- Do not claim that a skill or extension can migrate the current Pi process to another agent directory.
- For package and resource changes, prefer launching the profile and using `pi install`, `pi remove`, and `pi config` rather than hand-editing `settings.json` or filesystem paths.
- After mutating a profile's configuration or resources, validate `settings.json`, run `pi list`, inspect profile-local resources, and remind the user to run `/reload` if Pi is already running.
- Use `pi-profile resources <name>` to get an authoritative inventory of declared packages, loose resources, config-only extension directories, and stale installed-but-undeclared packages.
- Use `pi-profile doctor <name>` to surface missing packages, stale packages, and invalid settings. Treat `doctor` warnings as things to review, not always as things to delete.
