import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const categories = {
  user: "USER.md",
  hindsight: "HINDSIGHT.md",
  failure: "FAILURES.md",
} as const;

type Category = keyof typeof categories;
type MemoryFile = (typeof categories)[Category];

const contextLimits: Record<MemoryFile, number> = {
  "USER.md": 4_000,
  "HINDSIGHT.md": 8_000,
  "FAILURES.md": 4_000,
};
const maxFileSize = 64_000;

function memoryDir(): string {
  return path.join(process.env.PI_CODING_AGENT_DIR || ".", "memory");
}

function readMemory(): string {
  return Object.values(categories)
    .map((file) => {
      const full = path.join(memoryDir(), file);
      if (!fs.existsSync(full)) return "";
      const content = fs.readFileSync(full, "utf8");
      return `\n## ${file.replace(/\.md$/, "")}\n${content.slice(-contextLimits[file])}`;
    })
    .join("\n");
}

function appendMemory(category: Category, value: string, automatic = false): boolean {
  const clean = value.trim().replace(/\n{3,}/g, "\n\n").slice(0, 1_800);
  if (!clean) return false;

  const file = path.join(memoryDir(), categories[category]);
  if (!fs.existsSync(file)) return false;

  let current = fs.readFileSync(file, "utf8");
  if (current.includes(clean)) return false;

  const heading = automatic ? "Automatic settled outcome" : "Memory";
  const note = `\n\n## ${heading} - ${new Date().toISOString().slice(0, 10)}\n\n${clean}\n`;
  fs.appendFileSync(file, note);
  current += note;

  if (current.length > maxFileSize) {
    const title = current.split("\n").slice(0, 3).join("\n");
    fs.writeFileSync(file, `${title}\n\n<!-- Older entries compacted -->\n${current.slice(-48_000)}`);
  }
  return true;
}

function messageText(message: { content?: string | Array<{ type: string; text?: string }> } | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return (message.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("\n");
}

export default function profileMemory(pi: ExtensionAPI): void {
  let pendingOutcome = "";

  pi.on("before_agent_start", async (event) => {
    const memory = readMemory();
    if (!memory.trim()) return;
    return {
      systemPrompt:
        `${event.systemPrompt}\n\n## Active profile memory\n${memory}` +
        "\n\nUse profile_memory to save only durable preferences, reusable lessons, and recurring failures. " +
        "Do not save secrets or temporary task details.",
    };
  });

  pi.on("agent_end", async (event) => {
    const assistant = [...(event.messages || [])]
      .reverse()
      .find((message) => message.role === "assistant");
    pendingOutcome = messageText(assistant);
  });

  pi.on("agent_settled", async () => {
    if (pendingOutcome) appendMemory("hindsight", pendingOutcome, true);
    pendingOutcome = "";
  });

  pi.registerTool({
    name: "profile_memory",
    label: "Profile Memory",
    description:
      "Save a durable preference, reusable lesson, or recurring failure in the active profile's persistent memory.",
    promptSnippet: "Store durable profile-local memory",
    promptGuidelines: [
      "Use profile_memory when a stable user preference, reusable lesson, or recurring failure should persist across sessions; never store secrets or temporary task details.",
    ],
    parameters: Type.Object({
      category: Type.Union([
        Type.Literal("user"),
        Type.Literal("hindsight"),
        Type.Literal("failure"),
      ]),
      text: Type.String({ description: "Short, self-contained, actionable memory" }),
    }),
    async execute(_id, params) {
      const added = appendMemory(params.category, params.text);
      return {
        content: [
          {
            type: "text",
            text: added ? "Memory saved." : "Memory was empty, duplicate, or unavailable.",
          },
        ],
        details: { added },
      };
    },
  });

  pi.registerCommand("memory", {
    description: "Show this profile's persistent memory",
    handler: async (_args, ctx) => {
      ctx.ui.notify(readMemory() || "No profile memory yet.", "info");
    },
  });
}
