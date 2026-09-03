/** Terminal-like log: --help first, then argv-only commands. */
import { useEffect, useState, type FormEvent } from "react";
import { previewCLIEvents } from "./api.ts";

const DENIED = /[;|&`$<>(){}!\\\n]/;

export function CliStage({ repoUrl, reason }: { repoUrl: string; reason?: string }) {
  const [log, setLog] = useState("");
  const [line, setLine] = useState("");
  const [running, setRunning] = useState(false);
  const [deny, setDeny] = useState("");

  const run = (args: string) => {
    const ac = new AbortController();
    setRunning(true);
    setDeny("");
    void (async () => {
      try {
        for await (const ev of previewCLIEvents(repoUrl, args, ac.signal)) {
          if (ev.label) setLog(ev.label);
        }
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") setLog(err.message);
      } finally {
        setRunning(false);
      }
    })();
  };

  useEffect(() => {
    run("");
    // First paint is --help for this checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (running) return;
    if (DENIED.test(line)) {
      setDeny("Only arguments to this CLI — no shell.");
      return;
    }
    run(line);
  };

  return (
    <div className="sh-live-pack">
      <p className="sh-live-pack__why">{reason || "This is a command-line tool. Terra runs it here."}</p>
      <pre className="sh-live-pack__log sh-live-pack__log--tall">{log || (running ? "Running…" : "")}</pre>
      <form className="sh-live-cli" onSubmit={onSubmit}>
        <input
          className="sh-live-cli__in"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder="arguments only — e.g. map gh user"
          spellCheck={false}
          disabled={running}
          aria-label="CLI arguments"
        />
        <button type="submit" className="sh-chip sh-chip--btn" disabled={running}>
          Run
        </button>
      </form>
      {deny ? <p className="sh-live-pack__why">{deny}</p> : null}
    </div>
  );
}
