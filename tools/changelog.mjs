export function releaseNotesForVersion(markdown, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(
    `^##[ \\t]+\\[?${escaped}\\]?(?:[ \\t]+-[^\\r\\n]*)?[ \\t]*$`,
    "m",
  ).exec(markdown);
  if (!heading) return null;

  const bodyStart = heading.index + heading[0].length;
  const remainder = markdown.slice(bodyStart);
  const nextHeading = /^##\s+/m.exec(remainder);
  const bodyEnd = bodyStart + (nextHeading?.index ?? remainder.length);
  return markdown.slice(bodyStart, bodyEnd).trim();
}

export function releaseChangelog(markdown, version, date) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^##\\s+\\[?${escaped}\\]?`, "m").test(markdown)) return markdown;

  const heading = /^##[ \t]+\[Unreleased\][ \t]*$/m.exec(markdown);
  if (!heading) throw new Error("CHANGELOG.md is missing the [Unreleased] section");
  const bodyStart = heading.index + heading[0].length;
  const remainder = markdown.slice(bodyStart);
  const nextHeading = /^##\s+/m.exec(remainder);
  const bodyEnd = bodyStart + (nextHeading?.index ?? remainder.length);
  const body = markdown.slice(bodyStart, bodyEnd).trim();
  if (/^###\s+(?:Italiano|English)\s*$/im.test(body)) {
    throw new Error(
      "CHANGELOG.md [Unreleased] must contain English notes without language headings",
    );
  }
  if (!/^\s*[-*]\s+\S/m.test(body)) {
    throw new Error("CHANGELOG.md [Unreleased] has no release notes");
  }

  const replacement = `${heading[0]}\n\n## [${version}] - ${date}\n\n${body}\n\n`;
  return markdown.slice(0, heading.index) + replacement + markdown.slice(bodyEnd);
}
