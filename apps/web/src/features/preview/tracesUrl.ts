/** Build /traces SSE URL. Exported for tests. */
export function tracesURL(repoUrl: string, token: string): string {
  const params = new URLSearchParams({ repo_url: repoUrl });
  // EventSource cannot set Authorization headers; query token is the SSE fallback
  // accepted by server auth middleware for GET /traces only.
  if (token) params.set("token", token);
  return `/traces?${params}`;
}
