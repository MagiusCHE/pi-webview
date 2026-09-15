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
  if (!/^###\s+Italiano\s*$/m.test(body) || !/^###\s+English\s*$/m.test(body)) {
    throw new Error("CHANGELOG.md [Unreleased] must contain Italiano and English notes");
  }
  if (!/^\s*[-*]\s+\S/m.test(body)) {
    throw new Error("CHANGELOG.md [Unreleased] has no release notes");
  }

  const replacement = `${heading[0]}\n\n## [${version}] - ${date}\n\n${body}\n\n`;
  return markdown.slice(0, heading.index) + replacement + markdown.slice(bodyEnd);
}
