import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { hostCapabilities, models } from "../../../features/analysis";
import type { CatalogEntry, HostCapabilities } from "../../../features/analysis";
import { SessionModels } from "./SessionModels";

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

beforeEach(() => {
  localStorage.clear();
  vi.mocked(models).mockResolvedValue([localEntry, remoteEntry]);
  vi.mocked(hostCapabilities).mockResolvedValue(caps);
});

afterEach(cleanup);

async function openMenu() {
  fireEvent.click(await screen.findByRole("button", { name: /Choose model/ }));
}

test("the menu stays closed until the chat model chip is toggled", async () => {
  render(<SessionModels onChoose={vi.fn()} />);
  expect(await screen.findByRole("button", { name: /Choose model/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Local A/ })).toBeNull();

  await openMenu();
  expect(screen.getByRole("button", { name: /Local A/ })).toBeTruthy();
});

test("a working local model is open and choosing it does not ask for a key", async () => {
  const onChoose = vi.fn();
  render(<SessionModels onChoose={onChoose} />);
  await openMenu();

  fireEvent.click(screen.getByRole("button", { name: /Local A/ }));
  expect(onChoose).toHaveBeenCalledWith({ modelId: "local-a", apiKey: undefined });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a model that needs a key is closed until one is saved locally", async () => {
  const onChoose = vi.fn();
  render(<SessionModels onChoose={onChoose} />);
  await openMenu();

  const remote = screen.getByRole("button", { name: /Remote A/ });
  expect(remote.className).toMatch(/is-locked/);
  fireEvent.click(remote);
  expect(onChoose).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText("openai API key"), {
    target: { value: "sk-local" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save API key locally/ }));

  expect(localStorage.getItem("terra_key_openai")).toBe("sk-local");
  expect(onChoose).toHaveBeenCalledWith({ modelId: "remote-a", apiKey: "sk-local" });
});
