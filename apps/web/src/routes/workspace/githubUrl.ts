/** Extract and normalize a GitHub repo URL from pasted/dropped text. */

const GITHUB_RE =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=\/|[?\s#]|$)/i;

/** Pull the first GitHub owner/repo reference out of free text or a URI list. */
export function extractGitHubURL(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  // text/uri-list may include comment lines starting with #.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(GITHUB_RE);
    if (!match) continue;
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, "");
    return `https://github.com/${owner}/${repo}`;
  }
  return null;
}

/** Read a GitHub URL from a drag-and-drop DataTransfer, if any. */
export function githubURLFromDataTransfer(dt: DataTransfer): string | null {
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const fromList = extractGitHubURL(uriList);
    if (fromList) return fromList;
  }
  const plain = dt.getData("text/plain");
  if (plain) return extractGitHubURL(plain);
  return null;
}
