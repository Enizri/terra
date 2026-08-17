import { useEffect, useState, type FormEvent } from "react";
import { onUnauthorized, setToken } from "./token";
import "./unlock.css";

/** Minimal gate: paste TERRA_TOKEN after a 401, store in sessionStorage, reload. */
export default function UnlockPanel() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => onUnauthorized(() => setOpen(true)), []);

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setToken(token);
    setOpen(false);
    window.location.reload();
  };

  return (
    <div className="sh-unlock" role="dialog" aria-modal="true" aria-labelledby="sh-unlock-title">
      <form className="sh-unlock__card" onSubmit={submit}>
        <h2 id="sh-unlock-title">Unlock Terra</h2>
        <p>Paste the shared access token to continue.</p>
        <input
          className="sh-unlock__input"
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="TERRA_TOKEN"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="sh-unlock__btn" type="submit">
          Unlock
        </button>
      </form>
    </div>
  );
}
