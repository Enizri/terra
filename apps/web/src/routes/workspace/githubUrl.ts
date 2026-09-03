/** Extract and normalize a GitHub repo URL from pasted/dropped text. */

const GITHUB_RE =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=\/|[?\s#]|$)/i;

export interface ParsedGitHubURL {
  url: string;
  discardedBranch?: string;
  discardedPath?: string;
}

/** Pull the first GitHub owner/repo reference out of free text or a URI list. */
export function extractGitHubURL(raw: string): string | null {
  return parseGitHubURL(raw)?.url ?? null;
}

/** Like extractGitHubURL, plus any /tree/<branch> or subdirectory that was dropped. */
export function parseGitHubURL(raw: string): ParsedGitHubURL | null {
  const text = raw.trim();
  if (!text) return null;
  // text/uri-list may include comment lines starting with #.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(GITHUB_RE);
    if (!match || match.index == null) continue;
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, "");
    const parsed: ParsedGitHubURL = { url: `https://github.com/${owner}/${repo}` };
    const after = trimmed.slice(match.index + match[0].length);
    const rest = after.match(/^\/(tree|blob)\/([^/?#]+)(?:\/([^?#]*))?/);
    if (rest) {
      parsed.discardedBranch = decodeURIComponent(rest[2]);
      const sub = rest[3]?.replace(/\/+$/, "");
      if (sub) parsed.discardedPath = decodeURIComponent(sub);
    }
    return parsed;
  }
  return null;
}

/** Visible copy when a dropped/pasted URL named a branch or subdirectory. */
export function discardedRefNote(parsed: ParsedGitHubURL): string | null {
  const branch = parsed.discardedBranch;
  const sub = parsed.discardedPath;
  if (branch && sub) {
    return `Terra maps the default branch of the whole repository — the URL pointed at ${branch} and ${sub}.`;
  }
  if (branch) {
    return `Terra maps the default branch — the URL pointed at ${branch}.`;
  }
  if (sub) {
    return `Terra maps the whole repository — the path ${sub} was dropped.`;
  }
  return null;
}

/** Read a GitHub URL from a drag-and-drop DataTransfer, if any. */
export function githubURLFromDataTransfer(dt: DataTransfer): ParsedGitHubURL | null {
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const fromList = parseGitHubURL(uriList);
    if (fromList) return fromList;
  }
  const plain = dt.getData("text/plain");
  if (plain) return parseGitHubURL(plain);
  return null;
}
