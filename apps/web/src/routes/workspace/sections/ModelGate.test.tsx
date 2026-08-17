// The gate is the one thing standing between a pasted URL and a paid token,
// so its invariants are worth a real DOM. Runs under vitest (jsdom); the
// pure-logic suites stay on `node --test`.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { hostCapabilities, models } from "../../../features/analysis";
import type { CatalogEntry, HostCapabilities, Recommendation } from "../../../features/analysis";
import { ModelGate } from "./ModelGate";

vi.mock("../../../features/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../features/analysis")>();
  return {
    ...actual,
    models: vi.fn(),
    hostCapabilities: vi.fn(),
  };
});

const localEntry: CatalogEntry = {
  id: "local-a", kind: "local", display_name: "Local A", tier: "fast",
  blurb: "runs here", hf_id: "org/a", min_ram_gb: 8, size_gb: 3,
};
const remoteEntry: CatalogEntry = {
  id: "remote-a", kind: "remote", display_name: "Remote A", tier: "quality",
  blurb: "hosted", provider: "openai", base_url: "https://api.openai.com/v1",
  model: "m", requires_api_key: true,
};
const caps: HostCapabilities = { ram_gb: 64, device: "mps" };
const recommendation: Recommendation = {
  model_id: "local-a", reason: "reads this repo well", tier: "fast",
};

function mount(onContinue = vi.fn()) {
  render(
    <ModelGate recommendation={recommendation} onContinue={onContinue} onCancel={() => {}} />,
  );
  return onContinue;
}

/** Opens the full list and clicks the remote entry. */
async function pickTheRemote() {
  fireEvent.click(await screen.findByRole("button", { name: /Change model/ }));
  fireEvent.click(screen.getByRole("button", { name: /Remote A/ }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(models).mockResolvedValue([localEntry, remoteEntry]);
  vi.mocked(hostCapabilities).mockResolvedValue(caps);
});

afterEach(cleanup);

test("nothing is analyzed until the user hits Continue", async () => {
  const onContinue = mount();
  const go = await screen.findByRole("button", { name: /Continue with Local A/ });
  expect(onContinue).not.toHaveBeenCalled();

  fireEvent.click(go);
  expect(onContinue).toHaveBeenCalledWith("local-a", undefined, undefined);
});

test("a remote with no stored key opens the modal instead of starting", async () => {
  const onContinue = mount();
  await pickTheRemote();

  expect(onContinue).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("saving a key stores it per provider and then continues", async () => {
  const onContinue = mount();
  await pickTheRemote();

  fireEvent.change(screen.getByPlaceholderText("openai API key"), { target: { value: " sk-live " } });
  fireEvent.click(screen.getByRole("button", { name: /Save and continue/ }));

  expect(localStorage.getItem("terra_key_openai")).toBe("sk-live");
  expect(onContinue).toHaveBeenCalledWith("remote-a", "sk-live", "openai");
});

test("a remote whose key is already stored skips the modal", async () => {
  localStorage.setItem("terra_key_openai", "sk-stored");
  const onContinue = mount();
  await pickTheRemote();

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onContinue).toHaveBeenCalledWith("remote-a", "sk-stored", "openai");
});
