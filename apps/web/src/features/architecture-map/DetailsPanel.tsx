import { AnimatePresence, motion } from "motion/react";
import type { TerraMap } from "./types";
import styles from "./DetailsPanel.module.css";

interface Props {
  map: TerraMap;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function DetailsPanel({ map, selectedId, onSelect }: Props) {
  const component = map.components.find((comp) => comp.id === selectedId);
  const touching = component
    ? map.relationships.filter(
        (rel) => rel.from === component.id || rel.to === component.id,
      )
    : [];
  const nameOf = (id: string) =>
    map.components.find((comp) => comp.id === id)?.name ?? id;

  return (
    <div className={styles.slot}>
      <AnimatePresence mode="wait">
        {component ? (
          <motion.aside
            key={component.id}
            className={styles.panel}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <button
              className={styles.close}
              onClick={() => onSelect(null)}
              aria-label="Close details"
            >
              ×
            </button>
            <p className={styles.kicker}>
              {component.type}
              <span
                className={styles.importance}
                data-importance={component.importance}
              >
                {component.importance}
              </span>
            </p>
            <h3 className={styles.name}>{component.name}</h3>
            <p className={styles.purpose}>{component.purpose}</p>

            {component.tech && component.tech.length > 0 && (
              <div className={styles.chips}>
                {component.tech.map((tech) => (
                  <span key={tech} className={styles.chip}>
                    {tech}
                  </span>
                ))}
              </div>
            )}

            <p className={styles.subhead}>Where it lives</p>
            <ul className={styles.files}>
              {component.files.map((filePath) => (
                <li key={filePath}>{filePath}</li>
              ))}
            </ul>

            {touching.length > 0 && (
              <>
                <p className={styles.subhead}>Connections — with evidence</p>
                <ul className={styles.edges}>
                  {touching.map((rel) => (
                    <li
                      key={`${rel.from}-${rel.to}`}
                      className={styles.edgeItem}
                    >
                      <p className={styles.edgeHead}>
                        {rel.from === component.id ? (
                          <>
                            <em>{rel.type}</em> → {nameOf(rel.to)}
                          </>
                        ) : (
                          <>
                            {nameOf(rel.from)} <em>{rel.type}</em> → this
                          </>
                        )}
                      </p>
                      {rel.because.map((reason) => (
                        <p key={reason} className={styles.because}>
                          {reason}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </motion.aside>
        ) : (
          <motion.div
            key="empty"
            className={styles.empty}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className={styles.emptyTitle}>Click any component</p>
            <p className={styles.emptyBody}>
              Purpose, tech, files — and every connection backed by the exact
              file that proves it.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
