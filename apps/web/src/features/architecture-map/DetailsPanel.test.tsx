// The panel is the whole "a non-engineer can read this" claim, so what it puts
// on screen is worth a real DOM: sentences instead of enums, folders instead of
// a path dump, and a one-gesture route from a card to a question about it.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import DetailsPanel from "./DetailsPanel";
import type { TerraMap } from "./types";
import memos from "../../data/memos.map.json";

const golden = memos as TerraMap;

function mount(selectedIds: string[]) {
  const onSelect = vi.fn();
  const onAsk = vi.fn();
  render(
    <DetailsPanel map={golden} selectedIds={selectedIds} onSelect={onSelect} onAsk={onAsk} />,
  );
  return { onSelect, onAsk };
}

afterEach(cleanup);

test("with nothing selected the column is the map's table of contents", () => {
  const { onSelect } = mount([]);
  expect(screen.getByText("All parts")).toBeTruthy();
  // Including parts the diagram's node caps never drew as cards.
  fireEvent.click(screen.getByRole("button", { name: /AI Features/ }));
  expect(onSelect).toHaveBeenCalledWith("ai");
});

test("a relationship reads as a sentence, not as its wire type", () => {
  mount(["memos"]);
  expect(screen.getByText(/keeps its data in/)).toBeTruthy();
  // The wire type is present as a label, never inside the sentence.
  expect(screen.getByText("reads writes")).toBeTruthy();
  // The evidence is present but is not the headline.
  expect(screen.getByTitle(/store\/memo\.go/)).toBeTruthy();
});

test("the other end of a connection is a link, not something to hunt for", () => {
  const { onSelect } = mount(["memos"]);
  fireEvent.click(screen.getByRole("button", { name: "Data Storage" }));
  expect(onSelect).toHaveBeenCalledWith("data");
});

test("files are grouped by folder and open to the exact paths", () => {
  mount(["memos"]);
  expect(screen.getByText("3 files and 2 whole folders")).toBeTruthy();
  const group = screen.getByText("server/router/api/v1/").closest("details")!;
  // Collapsed by default: five paths in a column is what this replaces.
  expect(group.open).toBe(false);
  fireEvent.click(within(group).getByText("server/router/api/v1/"));
  expect(within(group).getByText("memo_service.go")).toBeTruthy();
});

test("asking about the open part is one gesture, with or without a question", () => {
  const { onAsk } = mount(["memos"]);
  fireEvent.click(screen.getByRole("button", { name: /Ask about Memo System/ }));
  expect(onAsk).toHaveBeenCalledWith("memos");

  fireEvent.click(screen.getByRole("button", { name: "What does Memo System do?" }));
  expect(onAsk).toHaveBeenLastCalledWith("memos", "What does Memo System do?");
});

test("a nested part says where it lives in the map and links back", () => {
  const { onSelect } = mount(["web.editor"]);
  expect(screen.getByText(/Part of/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Web Application" }));
  expect(onSelect).toHaveBeenCalledWith("web");
  // Nothing is wired to the editor in the golden map; the panel says so rather
  // than dropping the section.
  expect(screen.getByText(/Nothing in the map links to this part/)).toBeTruthy();
});

test("a stacked selection can hand the subject to another card", () => {
  const { onAsk } = mount(["api", "memos"]);
  const line = screen.getByText(/Also in the question/);
  fireEvent.click(within(line).getByRole("button", { name: "API Layer" }));
  expect(onAsk).toHaveBeenCalledWith("api");
});
