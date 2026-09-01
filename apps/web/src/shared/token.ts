/** Browser-only access token leftover (never baked into the Vite build).
 * The workspace no longer asks you to paste TERRA_TOKEN: Vite's proxy forwards
 * it from `.env`, and the Go API sets an HttpOnly cookie when it serves the UI. */
export const TOKEN_KEY = "terra_token";

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function notifyUnauthorized(): void {
  // 401s surface as request errors. There is no paste-token gate.
}
