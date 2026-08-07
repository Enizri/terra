/** Browser-only access token (never baked into the Vite build). */
export const TOKEN_KEY = "terra_token";

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token.trim());
}

const unauthorized = new Set<() => void>();

/** Subscribe to API 401s — used by the unlock panel. */
export function onUnauthorized(fn: () => void): () => void {
  unauthorized.add(fn);
  return () => {
    unauthorized.delete(fn);
  };
}

export function notifyUnauthorized(): void {
  for (const fn of unauthorized) fn();
}
