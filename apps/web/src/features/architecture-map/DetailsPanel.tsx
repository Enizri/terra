// The reading column beside the map: what a part is, what it talks to, what is
// inside it, where it lives, and one gesture to ask about it.
//
// It is mounted whether or not a card is selected — see `.sh-ws__map` in
// stage.css for why the column is permanent — so it has two faces: a table of
// contents for the whole repository, and the detail for one component.

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { ArrowIcon, ChevronIcon } from "../../shared/shell/icons";
import TechIcon from "./TechIcon";
import { kindOf } from "./toDiagram";
import {
  childrenOf,
  connectionsOf,
  filesSummary,
  importanceLabel,
  importanceLine,
  layerLabel,
  parentOf,
  summarizeFiles,
  type Connection,
  type Endpoint,
  type FileGroup,
} from "./explain";
import type { Component, TerraMap } from "./types";
import styles from "./DetailsPanel.module.css";

interface Props {
  map: TerraMap;
  /** Stacked selections, oldest first. The last one is what the panel reads. */
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  /** Make this component the subject of the next question; a `question` sends
   *  it straight away instead of only focusing the composer. */
  onAsk: (id: string, question?: string) => void;
}

/** Questions worth one click, named after the part so the answer is scoped. */
const starters = (name: string) => [
  `What does ${name} do?`,
  `What breaks if I change ${name}?`,
];

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <p className={styles.subhead}>
      <span>{title}</span>
      {note && <em>{note}</em>}
    </p>
  );
}

/** One relationship as a sentence. The end that is *not* the open component is
 *  the link, so following the wiring is a click and never a hunt on the canvas. */
function ConnectionRow({
  conn,
  selfId,
  onSelect,
}: {
  conn: Connection;
  selfId: string;
  onSelect: (id: string) => void;
}) {
  const end = (side: Endpoint) =>
    side.id === selfId ? (
      <b className={styles.self}>{side.name}</b>
    ) : (
      <button type="button" className={styles.jump} onClick={() => onSelect(side.id)}>
        {side.name}
      </button>
    );

  return (
    <li className={styles.conn} data-dir={conn.outgoing ? "out" : "in"}>
      {/* The map's own word for the edge, on its own line. A reader who wants
          the term has it, and keeping it out of the sentence is the point:
          inline, "Data Storage reads writes" reads as more sentence. */}
      <p className={styles.connTag}>
        <span aria-hidden>{conn.outgoing ? "→" : "←"}</span>
        {conn.raw}
      </p>
      <p className={styles.sentence}>
        {end(conn.from)} <span className={styles.verb}>{conn.verb}</span> {end(conn.to)}
        {conn.tail ? ` ${conn.tail}` : ""}
      </p>
      {conn.because.map((reason) => (
        <p key={reason} className={styles.evidence} title={reason}>
          {reason}
        </p>
      ))}
    </li>
  );
}

/** Evidence folded to one row per folder, each expandable to the exact paths. */
function FileGroupRow({ group }: { group: FileGroup }) {
  const [only] = group.items;
  if (group.items.length === 1) {
    return (
      <li className={styles.fileRow} title={only.path}>
        <span className={styles.path}>{only.path}</span>
        {only.folder && <em>whole folder</em>}
      </li>
    );
  }
  return (
    <li>
      <details className={styles.fileGroup}>
        <summary>
          <span className={styles.chev} aria-hidden>
            <ChevronIcon />
          </span>
          <span className={styles.path}>{group.dir ? `${group.dir}/` : "repository root"}</span>
          <em>{group.items.length} files</em>
        </summary>
        <ul className={styles.paths}>
          {group.items.map((item) => (
            <li key={item.path} title={item.path}>
              {item.name}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function Detail({
  map,
  component,
  selectedIds,
  onSelect,
  onAsk,
}: Props & { component: Component }) {
  const connections = useMemo(() => connectionsOf(map, component.id), [map, component.id]);
  const inside = useMemo(
    () => childrenOf(map.components, component.id),
    [map.components, component.id],
  );
  const parent = parentOf(map.components, component.id);
  const groups = useMemo(() => summarizeFiles(component.files), [component.files]);
  const counted = component.file_count ?? 0;
  const stacked = selectedIds.filter((id) => id !== component.id);

  return (
    <>
      <div className={styles.head}>
        <button type="button" className={styles.back} onClick={() => onSelect(null)}>
          <span className={styles.backChev} aria-hidden>
            <ChevronIcon />
          </span>
          All parts
        </button>
        <span className={styles.kicker}>
          {layerLabel(component.type)}
          <span className={styles.importance} data-importance={component.importance}>
            {importanceLabel(component.importance)}
          </span>
        </span>
      </div>

      <div className={styles.body}>
        <div className={styles.title}>
          <span className={styles.titleIcon} aria-hidden>
            <TechIcon tech={component.tech} kind={kindOf(component.type)} label={component.name} />
          </span>
          <h3 className={styles.name}>{component.name}</h3>
        </div>

        {parent && (
          <p className={styles.crumb}>
            Part of{" "}
            <button type="button" className={styles.jump} onClick={() => onSelect(parent.id)}>
              {parent.name}
            </button>
          </p>
        )}

        <p className={styles.purpose}>{component.purpose}</p>
        <p className={styles.weight}>{importanceLine(component.importance)}</p>

        {component.tech && component.tech.length > 0 && (
          <div className={styles.chips}>
            {component.tech.map((tech) => (
              <span key={tech} className={styles.chip}>
                {tech}
              </span>
            ))}
          </div>
        )}

        {/* The whole point of clicking a card: the question you now have is
            about this part, and asking it should not mean retyping its name. */}
        <div className={styles.ask}>
          <button
            type="button"
            className={styles.askMain}
            onClick={() => onAsk(component.id)}
          >
            Ask about {component.name}
            <span className={styles.askArrow} aria-hidden>
              <ArrowIcon />
            </span>
          </button>
          <div className={styles.askChips}>
            {starters(component.name).map((question) => (
              <button
                key={question}
                type="button"
                className={styles.askChip}
                onClick={() => onAsk(component.id, question)}
              >
                {question}
              </button>
            ))}
          </div>
          {stacked.length > 0 && (
            <p className={styles.stacked}>
              Also in the question:{" "}
              {stacked.map((id, i) => (
                <span key={id}>
                  {/* The separator is a text node, not a ::before on the
                      button: a comma glued to the next name wraps with it and
                      starts the line. */}
                  {i > 0 ? ", " : ""}
                  <button type="button" className={styles.jump} onClick={() => onAsk(id)}>
                    {map.components.find((c) => c.id === id)?.name ?? id}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>

        <section>
          <SectionHead
            title="How it connects"
            note={`${connections.length} link${connections.length === 1 ? "" : "s"}`}
          />
          {/* Said out loud rather than left as an absent section: "nothing is
              wired to this" is an answer, and a missing heading is not. */}
          {connections.length === 0 ? (
            <p className={styles.note}>
              Nothing in the map links to this part
              {parent ? <> — it lives inside {parent.name}.</> : " on its own."}
            </p>
          ) : (
            <ul className={styles.conns}>
              {connections.map((conn) => (
                <ConnectionRow
                  key={conn.key}
                  conn={conn}
                  selfId={component.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </section>

        {inside.length > 0 && (
          <section>
            <SectionHead
              title="What's inside"
              note={`${inside.length} part${inside.length === 1 ? "" : "s"}`}
            />
            <ul className={styles.inside}>
              {inside.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className={styles.insideRow}
                    onClick={() => onSelect(child.id)}
                  >
                    <b>{child.name}</b>
                    <em>{child.purpose}</em>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length > 0 && (
          <section>
            <SectionHead title="Where it lives" note={filesSummary(groups)} />
            {/* Only when the analyzer counted: the evidence list is a sample of
                a 530-file component, and saying so is the difference between
                "five files" and "five files worth quoting". */}
            {counted > 1 && (
              <p className={styles.note}>
                About {counted.toLocaleString()} files sit under this part in total.
              </p>
            )}
            <ul className={styles.files}>
              {groups.map((group) => (
                <FileGroupRow key={group.dir} group={group} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

/** No selection: the column becomes the table of contents, so every part —
 *  including the ones the diagram's caps left off the canvas — is one click
 *  away instead of being something to hunt for. */
function Overview({ map, onSelect }: { map: TerraMap; onSelect: (id: string) => void }) {
  const layers = useMemo(() => {
    const order = new Map<string, Component[]>();
    for (const component of map.components) {
      const layer = layerLabel(component.type);
      const bucket = order.get(layer) ?? [];
      bucket.push(component);
      order.set(layer, bucket);
    }
    return [...order.entries()];
  }, [map.components]);

  return (
    <>
      <div className={styles.head}>
        <span className={styles.headTitle}>All parts</span>
        <span className={styles.kicker}>{map.components.length} in this repo</span>
      </div>
      <div className={styles.body}>
        <h3 className={styles.name}>{map.project.name}</h3>
        <p className={styles.purpose}>{map.project.description}</p>
        <div className={styles.chips}>
          {map.project.kind && <span className={styles.chip}>{map.project.kind}</span>}
          {map.project.primary_languages.map((lang) => (
            <span key={lang} className={styles.chip}>
              {lang}
            </span>
          ))}
          {map.project.stats.approx_source_files > 0 && (
            <span className={styles.chip}>
              ~{map.project.stats.approx_source_files.toLocaleString()} files
            </span>
          )}
        </div>

        <p className={styles.hint}>
          Click a card on the map — or a part below — to read what it does, what it talks to,
          and the code behind it.
        </p>

        {layers.map(([layer, components]) => (
          <section key={layer}>
            <SectionHead title={layer} note={`${components.length}`} />
            <ul className={styles.inside}>
              {components.map((component) => (
                <li key={component.id}>
                  <button
                    type="button"
                    className={styles.insideRow}
                    data-nested={component.parent_id ? "" : undefined}
                    onClick={() => onSelect(component.id)}
                  >
                    <b>{component.name}</b>
                    <em>{component.purpose}</em>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export default function DetailsPanel({ map, selectedIds, onSelect, onAsk }: Props) {
  const reduced = useReducedMotion();
  const primaryId = selectedIds[selectedIds.length - 1] ?? null;
  const component = map.components.find((comp) => comp.id === primaryId) ?? null;

  return (
    <div className={styles.slot}>
      {/* A fade, not a slide: the column never moves, so anything that travels
          would be motion invented for its own sake. Keyed on the component so
          swapping parts reads as a page turn rather than a diff. */}
      <motion.div
        key={component?.id ?? "overview"}
        className={styles.panel}
        initial={{ opacity: 0, y: reduced ? 0 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
      >
        {component ? (
          <Detail
            map={map}
            component={component}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onAsk={onAsk}
          />
        ) : (
          <Overview map={map} onSelect={onSelect} />
        )}
      </motion.div>
    </div>
  );
}
