import { Router, Request, Response } from 'express';

const router = Router();

let isReady = false;

export function setReady(ready: boolean): void {
  isReady = ready;
}

/**
 * Optional async readiness checker (e.g., blob storage ping).
 * When set, `/health/ready` calls this function instead of relying on the
 * simple `isReady` boolean.  The result is cached for `READINESS_CACHE_TTL_MS`.
 */
export type ReadinessChecker = () => Promise<void>;

const READINESS_CACHE_TTL_MS = 30_000;

let readinessChecker: ReadinessChecker | null = null;
let cachedReady: boolean | null = null;
let cacheExpiresAt = 0;

export function setReadinessChecker(checker: ReadinessChecker): void {
  readinessChecker = checker;
}

/** Visible for testing – resets internal readiness state (checker + cache). */
export function _resetReadinessState(): void {
  readinessChecker = null;
  cachedReady = null;
  cacheExpiresAt = 0;
}

router.get('/startup', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'started' });
});

router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

router.get('/ready', async (_req: Request, res: Response) => {
  // If no async checker is configured, fall back to the simple flag
  // (used for memory backend or before startup completes).
  if (!readinessChecker) {
    if (isReady) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
    return;
  }

  // Startup has not completed yet – not ready regardless of cache.
  if (!isReady) {
    res.status(503).json({ status: 'not ready' });
    return;
  }

  // Return cached result when still valid.
  const now = Date.now();
  if (cachedReady !== null && now < cacheExpiresAt) {
    if (cachedReady) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not ready' });
    }
    return;
  }

  // Execute the checker and cache the outcome.
  try {
    await readinessChecker();
    cachedReady = true;
    cacheExpiresAt = now + READINESS_CACHE_TTL_MS;
    res.status(200).json({ status: 'ready' });
  } catch {
    cachedReady = false;
    cacheExpiresAt = now + READINESS_CACHE_TTL_MS;
    res.status(503).json({ status: 'not ready' });
  }
});

export default router;
