function isLocalhostHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Read at call time, not at module load.
 *
 * Vite substitutes `import.meta.env` at build time, so this is equivalent in a
 * production bundle — but capturing it in a module-level `const` froze the
 * value before any test could set it, which meant the deployment-specific
 * branches below were unreachable from the test suite.
 */
function configuredBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
}

export function isApiBaseUrlConfigured(): boolean {
  return configuredBaseUrl().length > 0;
}

export function resolveApiBaseUrl(): string {
  const configured = configuredBaseUrl();
  if (configured) {
    return configured;
  }
  const { hostname, origin } = window.location;
  if (import.meta.env.DEV || isLocalhostHost(hostname)) {
    return "/api/v1";
  }
  return `${origin.replace(/\/+$/, "")}/api/v1`;
}

/**
 * Why this file grew a health probe.
 *
 * The old catch-all said "无法连接 X，请检查网络与跨域配置" for three unrelated
 * failures, because `fetch` throws an indistinguishable `TypeError` for all of
 * them: the host is unreachable, the host answered but the browser refused to
 * hand the response to the page (CORS), or the backend is a sleeping free-tier
 * instance still waking up. A whole debugging session was spent chasing CORS
 * when the real answer was a cold start, so the message now has to earn its
 * accusation before making it.
 *
 * `/health/live` is what earns it. It is a plain GET with no credentials and
 * no custom headers, so it needs no preflight, and probing it twice separates
 * the three cases:
 *
 *   reachable — a CORS-readable 2xx came back. The API is up AND this origin
 *               is allow-listed. Anything still failing is not connectivity.
 *   answered  — the same-origin-policy blocked the read, but a `no-cors`
 *               request resolved, so *something* is answering at that address.
 *               That is either a waking instance serving its platform's 502
 *               (no CORS headers on an error page) or a genuine CORS
 *               misconfiguration.
 *   silent    — nothing answered at all: DNS, offline, or the service is gone.
 */
export type ApiProbeResult = "reachable" | "answered" | "silent";

const PROBE_TIMEOUT_MS = 5000;

/** Backoff schedule in milliseconds, tuned for a free-tier cold start. */
const PROBE_DELAYS_MS = [0, 1000, 2000, 4000, 6000, 8000, 10000, 12000];

function abortAfter(timeoutMs: number): AbortSignal | undefined {
  // `AbortSignal.timeout` is unavailable in some test environments; losing the
  // per-attempt timeout there is acceptable, silently throwing is not.
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

export function healthProbeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/health/live`;
}

export async function probeApiOnce(
  baseUrl: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<ApiProbeResult> {
  const url = healthProbeUrl(baseUrl);
  try {
    const response = await fetch(url, { cache: "no-store", signal: abortAfter(timeoutMs) });
    // A readable non-2xx still proves both reachability and CORS, but the app
    // is not serving yet — that is exactly the "waking" shape.
    return response.ok ? "reachable" : "answered";
  } catch {
    try {
      // Opaque by design: we only need to learn whether bytes came back.
      await fetch(url, { cache: "no-store", mode: "no-cors", signal: abortAfter(timeoutMs) });
      return "answered";
    } catch {
      return "silent";
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface WaitForApiOptions {
  /** Total wall-clock budget. A sleeping free-tier instance needs tens of seconds. */
  budgetMs?: number;
  /** Called after each failed attempt so a caller can show "服务正在启动…". */
  onAttempt?: (result: ApiProbeResult, attempt: number) => void;
}

/**
 * Poll `/health/live` until it is readable or the budget runs out.
 *
 * Returns the *best* state observed, not the last one: a single "answered"
 * anywhere in the sequence rules out "nothing is there", which is the
 * distinction the error message hangs on.
 */
export async function waitForApi(
  baseUrl: string,
  { budgetMs = 45_000, onAttempt }: WaitForApiOptions = {}
): Promise<ApiProbeResult> {
  const startedAt = Date.now();
  let best: ApiProbeResult = "silent";
  for (let attempt = 0; attempt < PROBE_DELAYS_MS.length; attempt += 1) {
    const delay = PROBE_DELAYS_MS[attempt];
    if (delay > 0) {
      if (Date.now() - startedAt + delay > budgetMs) break;
      await sleep(delay);
    }
    const result = await probeApiOnce(baseUrl);
    if (result === "reachable") return "reachable";
    if (result === "answered") best = "answered";
    onAttempt?.(result, attempt);
    if (Date.now() - startedAt >= budgetMs) break;
  }
  return best;
}

function currentOrigin(): string {
  return typeof window === "undefined" ? "当前站点" : window.location.origin;
}

export function explainApiConnectionError(
  operation: string,
  baseUrl: string,
  probe: ApiProbeResult = "silent"
): string {
  if (!isApiBaseUrlConfigured()) {
    return `${operation} 失败：VITE_API_BASE_URL 未配置，当前会回退请求 ${baseUrl}。\n` +
      "请在部署环境中设置正确的 VITE_API_BASE_URL（例如 https://api.example.com/api/v1），\n" +
      "并确保域名可达。";
  }
  if (probe === "reachable") {
    // The health check is readable from this origin, so the address, the
    // service and the CORS allow-list are all fine — blaming any of them here
    // would send the next person down the wrong path.
    return `${operation} 失败：${baseUrl} 可以正常访问，但这个请求没有完成。请重试；` +
      "若持续失败，请查看后端日志中对应的 X-Request-ID。";
  }
  if (probe === "answered") {
    return `${operation} 失败：${baseUrl} 有响应，但浏览器不允许页面读取它。\n` +
      `常见原因有两个：后端正在启动（休眠的免费实例会先返回不带 CORS 头的错误页），` +
      `或者 ${currentOrigin()} 不在后端的 CORS 白名单（APP_CORS_ORIGINS）里。\n` +
      "请先稍候重试；若一直如此，请检查白名单。";
  }
  return `${operation} 失败：${baseUrl} 没有任何响应。\n` +
    "请检查网络连接，以及后端服务是否在线、域名是否正确。";
}

