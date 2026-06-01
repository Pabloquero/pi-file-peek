function applyInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, value) => `‹${value}›`)
    .replace(/\*\*([^*]+)\*\*/g, (_m, value) => value)
    .replace(/__([^_]+)__/g, (_m, value) => value);
}

export function renderMarkdown(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      out.push(inCodeFence ? "╭─ code" : "╰─");
      continue;
    }
    if (inCodeFence) {
      out.push(`│ ${line}`);
      continue;
    }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      out.push("─".repeat(24));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = applyInlineMarkdown(heading[2]);
      out.push("");
      out.push(level === 1 ? text.toUpperCase() : text);
      if (level <= 2) out.push(level === 1 ? "═".repeat(24) : "─".repeat(20));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      out.push(`▎ ${applyInlineMarkdown(quote[1])}`);
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1]}• ${applyInlineMarkdown(bullet[2])}`);
      continue;
    }
    const numbered = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
    if (numbered) {
      out.push(`${numbered[1]}${numbered[2]}. ${applyInlineMarkdown(numbered[3])}`);
      continue;
    }
    out.push(applyInlineMarkdown(line));
  }

  return out;
}
