---
name: pi-profile
description: Use when the user asks about Pi profiles, isolated Pi agents, profile-specific auth/config, profile-local memory, or managing the external pi-profile CLI.
---

# pi-profile

`pi-profile` is a Hermes-style external profile launcher for Pi. It starts a new Pi process with `PI_CODING_AGENT_DIR` set to a profile directory, giving that profile its own Pi settings, resources, sessions, instructions, and memory.

## Critical limitation

Profiles are selected before Pi starts. You cannot switch the profile of the currently running Pi process. Tell users to exit Pi and run:

```bash
pi-profile <name>
```

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
```

## Profile contents

Profiles live under `~/.pi/profiles/<name>/` and contain a native Pi agent directory plus metadata. The default template is blank in personality but has persistent memory; `coding`, `research`, and `personal` templates additionally seed Pi instruction files:

- `settings.json`, resources, and `sessions/`
- shared or profile-local `auth.json` and `models.json`
- `AGENTS.md` and `APPEND_SYSTEM.md` for profile instructions
- `profile.json` for launcher metadata
- `memory/USER.md`, `HINDSIGHT.md`, and `FAILURES.md`
- `extensions/pi-profile-memory.ts`

The memory extension loads bounded profile memory into prompts, provides `profile_memory` for durable classified entries, and records a bounded outcome after the agent fully settles. It is profile-local and does not generate or update skills. Memory is copied only by `--clone-all`.

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

- Prefer `pi-profile list --json`, `pi-profile show <name> --json`, and `pi-profile current --json` for machine-readable output.
- Use the CLI rather than editing `~/.pi/profiles` manually.
- Explain that profiles isolate Pi state, not workspace filesystem access or sandbox permissions.
- Do not claim that a skill or extension can migrate the current Pi process to another agent directory.
