import { useState, type FormEvent } from "react";
import "../../../shared/unlock.css";

/** BYOK prompt for one provider. The key goes to localStorage and rides on
 * the analyze request; Terra's server never stores it. */
export function ApiKeyModal({
  provider,
  modelName,
  onSubmit,
  onCancel,
}: {
  provider: string;
  modelName: string;
  onSubmit: (key: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!key) return;
    onSubmit(key);
  };

  return (
    <div className="sh-unlock" role="dialog" aria-modal="true" aria-labelledby="sh-key-title">
      <form className="sh-unlock__card" onSubmit={submit}>
        <h2 id="sh-key-title">{provider} API key</h2>
        <p>
          {modelName} runs on {provider}. The key stays in this browser and is sent only with
          your analysis requests.
        </p>
        <input
          className="sh-unlock__input"
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={`${provider} API key`}
          aria-label={`${provider} API key`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="sh-unlock__btn" type="submit">
          Save and continue
        </button>
        <button className="sh-ws__stop" type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}
