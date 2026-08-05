import { AnimatePresence, motion } from "motion/react";
import type { TerraMap } from "./types";
import styles from "./DetailsPanel.module.css";

interface Props {
  map: TerraMap;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function DetailsPanel({ map, selectedId, onSelect }: Props) {
  const c = map.components.find((x) => x.id === selectedId);
  const touching = c
    ? map.relationships.filter((r) => r.from === c.id || r.to === c.id)
    : [];
  const nameOf = (id: string) =>
    map.components.find((x) => x.id === id)?.name ?? id;

  return (
    <div className={styles.slot}>
      <AnimatePresence mode="wait">
        {c ? (
          <motion.aside
            key={c.id}
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
              {c.type}
              <span
                className={styles.importance}
                data-importance={c.importance}
              >
                {c.importance}
              </span>
            </p>
            <h3 className={styles.name}>{c.name}</h3>
            <p className={styles.purpose}>{c.purpose}</p>

            {c.tech && c.tech.length > 0 && (
              <div className={styles.chips}>
                {c.tech.map((t) => (
                  <span key={t} className={styles.chip}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            <p className={styles.subhead}>Where it lives</p>
            <ul className={styles.files}>
              {c.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>

            {touching.length > 0 && (
              <>
                <p className={styles.subhead}>Connections — with evidence</p>
                <ul className={styles.edges}>
                  {touching.map((r) => (
                    <li key={`${r.from}-${r.to}`} className={styles.edgeItem}>
                      <p className={styles.edgeHead}>
                        {r.from === c.id ? (
                          <>
                            <em>{r.type}</em> → {nameOf(r.to)}
                          </>
                        ) : (
                          <>
                            {nameOf(r.from)} <em>{r.type}</em> → this
                          </>
                        )}
                      </p>
                      {r.because.map((b) => (
                        <p key={b} className={styles.because}>
                          {b}
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
