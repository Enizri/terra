/** Browser-only provider API keys (BYOK). Never sent to Terra's store — they
 * ride along on the analyze/ask request and the server drops them. */

/** localStorage, unlike the access token's sessionStorage: a key the user
 * pasted once should survive closing the tab. */
const prefix = "terra_key_";

export function apiKeyStorageKey(provider: string): string {
  return prefix + provider;
}

export function getApiKey(provider: string): string {
  if (!provider) return "";
  try {
    return localStorage.getItem(apiKeyStorageKey(provider))?.trim() ?? "";
  } catch {
    // Private mode / disabled storage: behave as "no key stored".
    return "";
  }
}

export function setApiKey(provider: string, key: string): void {
  if (!provider) return;
  try {
    const trimmed = key.trim();
    if (!trimmed) {
      clearApiKey(provider);
      return;
    }
    localStorage.setItem(apiKeyStorageKey(provider), trimmed);
  } catch {
    // Nothing to do: the key just won't be remembered next time.
  }
}

export function clearApiKey(provider: string): void {
  try {
    localStorage.removeItem(apiKeyStorageKey(provider));
  } catch {
    // ignore
  }
}

/** True when a provider rejected the key we sent, so it should be forgotten
 * and asked for again rather than retried. */
export function isAuthFailure(message: string): boolean {
  return /\b(401|403|unauthorized|invalid[_ ]api[_ ]key|incorrect api key)\b/i.test(message);
}

/** The model this browser last worked with. Ask and the agent must send a
 * model the host is actually serving: with the field empty the analyzer falls
 * back to the operator's TERRA_MODEL env, which is not necessarily what the
 * local sidecar has loaded, and every question fails preflight. */
const modelKey = "terra_model_choice";

export type StoredChoice = { modelId: string; provider?: string };

export function getModelChoice(): StoredChoice | null {
  try {
    const raw = localStorage.getItem(modelKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChoice;
    return parsed?.modelId ? parsed : null;
  } catch {
    // Absent, unreadable, or written by an older build: no choice remembered.
    return null;
  }
}

export function setModelChoice(choice: StoredChoice): void {
  if (!choice.modelId) return;
  try {
    localStorage.setItem(modelKey, JSON.stringify(choice));
  } catch {
    // Nothing to do: the choice just won't survive this tab.
  }
}
