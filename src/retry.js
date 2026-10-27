const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `fn` until it succeeds, backing off exponentially with full jitter. An error with `retryable === false`
// (a 4xx that will never succeed) stops at once; `retryAfterMs` (from a 429's Retry-After) is honoured.
export async function withRetry(fn, { attempts = 5, baseMs = 500, maxMs = 30_000, sleep = wait, random = Math.random } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === attempts) break;
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      await sleep(Math.max(error?.retryAfterMs ?? 0, Math.round(random() * backoff)));
    }
  }
  throw lastError;
}

// An HTTP failure, marked retryable for network errors, 408, 429 and 5xx.
export class HttpError extends Error {
  constructor(status, message, retryAfterMs) {
    super(message);
    this.status = status;
    this.retryable = status === undefined || status === 408 || status === 429 || status >= 500;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function fetchOk(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new HttpError(undefined, `network error: ${error.message}`);
  }
  if (!response.ok) {
    const seconds = Number(response.headers?.get?.("retry-after"));
    const text = await response.text().catch(() => "");
    throw new HttpError(response.status, `${response.status} from ${new URL(url).host}: ${text.slice(0, 200)}`, Number.isFinite(seconds) ? seconds * 1000 : undefined);
  }
  return response;
}
