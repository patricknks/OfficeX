// Talking to the OfficeX server. Paths are relative so the GUI works under any base path (e.g. /OfficeX/).

/** true when the GUI is connected to a live OfficeX engine (not the demo simulator). */
export const bridge = { on: false };

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

/** Fire-and-forget call in live mode; errors show up as a toast. */
export function call(method: string, path: string, body?: unknown) {
  if (!bridge.on) return;
  api(method, path, body).catch((err: Error) => window.dispatchEvent(new CustomEvent('ox:error', { detail: err.message })));
}
