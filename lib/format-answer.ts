import { formatTimestamp } from "@/lib/format";
import type { Segment } from "@/lib/types";

const segmentIdPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const protectedMarkdown =
  /(```[\s\S]*?```|`[^`\n]+`|\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*)/g;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function emphasizeNames(text: string, names: Iterable<string>) {
  const list = [...new Set(names)]
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name !== "Unknown")
    .sort((left, right) => right.length - left.length);
  if (list.length === 0) return text;
  const pattern = new RegExp(
    `(?<!\\*)\\b(?:${list.map(escapeRegExp).join("|")})\\b(?!\\*)`,
    "g",
  );
  return text
    .split(protectedMarkdown)
    .map((part) =>
      part.startsWith("**") || part.startsWith("[") || part.startsWith("`")
        ? part
        : part.replace(pattern, (name) => `**${name}**`),
    )
    .join("");
}

export function answerMarkdown(
  text: string,
  byId: Map<string, Segment>,
  names: Iterable<string>,
) {
  const withCitations = text.replace(/\r\n/g, "\n").replace(
    /[ \t]*\[segment:([^\]]+)\][ \t]*/gi,
    (full, raw: string, offset: number, source: string) => {
      const id = segmentIdPattern.exec(raw)?.[0];
      const segment = id ? byId.get(id) : undefined;
      if (!segment) return " ";
      const next = source[offset + full.length] ?? "";
      const spaceAfter = /[,.;:!?]/.test(next) ? "" : " ";
      const label = formatTimestamp(segment.startMs);
      return ` [${label}](#segment/${segment.id})${spaceAfter}`;
    },
  );
  const softened = withCitations
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/([^\n])\n(?!\n)(?![-*] |\d+\. |#)/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return emphasizeNames(softened, names);
}
