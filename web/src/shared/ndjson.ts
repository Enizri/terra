/**
 * Splits a stream of chunks into whole NDJSON lines. Chunks arrive on socket
 * boundaries, not line boundaries, so the tail of a chunk is usually a partial
 * line — it's held until the rest shows up.
 */
export function ndjsonSplitter<T>() {
  let buffer = "";
  return (chunk: string): T[] => {
    buffer += chunk;
    const lines = buffer.split("\n");
    // Last element is the unterminated remainder ("" if the chunk ended clean).
    buffer = lines.pop() ?? "";
    const out: T[] = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      out.push(JSON.parse(line) as T);
    }
    return out;
  };
}
