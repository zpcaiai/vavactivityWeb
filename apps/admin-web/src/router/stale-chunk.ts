/**
 * Recover from a chunk that a newer deployment has already deleted.
 *
 * Both apps lazy-load every route (`() => import(...)`), and Vite names those
 * chunks by content hash. A visitor who loaded `index.html` before a deploy
 * keeps an entry bundle that points at the *previous* hashes; after the deploy
 * those files are gone, so the next navigation dies with "Failed to fetch
 * dynamically imported module" and the app is stuck until the user thinks to
 * hard-reload. Nothing is actually broken — the client is just one deploy
 * behind — so the fix is to fetch the new `index.html` once.
 *
 * Reloading on a *network* failure would be wrong: an offline user would be
 * thrown into a reload loop that cannot succeed. So this reloads at most once
 * per session per path, and lets a second failure surface as a real error.
 */

const RELOAD_MARKER = "vav:stale-chunk-reload";

/** Vite, Firefox and WebKit each word this differently; match all of them. */
const STALE_CHUNK_PATTERN =
  /(dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module)/i;

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return STALE_CHUNK_PATTERN.test(message);
}

function alreadyRetried(key: string): boolean {
  try {
    return window.sessionStorage.getItem(RELOAD_MARKER) === key;
  } catch {
    // Private browsing can throw on sessionStorage. Treating that as "already
    // retried" is the safe side of the trade: no reload loop, just an error.
    return true;
  }
}

function rememberRetry(key: string): void {
  try {
    window.sessionStorage.setItem(RELOAD_MARKER, key);
  } catch {
    /* nothing to do — the guard above will have already refused the retry */
  }
}

export function clearStaleChunkMarker(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_MARKER);
  } catch {
    /* ignore */
  }
}

/**
 * @returns whether a reload was triggered. Callers should stop navigating when
 *          it is `true`, since the document is being replaced.
 */
export function recoverFromStaleChunk(error: unknown, targetPath: string): boolean {
  if (!isStaleChunkError(error)) return false;
  if (alreadyRetried(targetPath)) return false;
  rememberRetry(targetPath);
  window.location.assign(targetPath);
  return true;
}
