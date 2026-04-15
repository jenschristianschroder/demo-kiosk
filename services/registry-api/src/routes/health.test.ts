import healthRouter, {
  setReady,
  setReadinessChecker,
  _resetReadinessState,
} from './health';
import express from 'express';
import http from 'http';

// ── Minimal test harness ──────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use('/health', healthRouter);
  return app;
}

function request(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server not listening'));
      return;
    }
    const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch (error) {
          reject(error);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('health routes', () => {
  let server: http.Server;

  beforeEach((done) => {
    // Reset all module state between tests
    setReady(false);
    _resetReadinessState();
    server = createApp().listen(0, done);
  });

  afterEach((done) => {
    server.close(done);
  });

  // ── /health/startup ──────────────────────────────────────────────────────

  describe('GET /health/startup', () => {
    it('returns 200', async () => {
      const res = await request(server, '/health/startup');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'started' });
    });
  });

  // ── /health/live ─────────────────────────────────────────────────────────

  describe('GET /health/live', () => {
    it('returns 200 (always lightweight)', async () => {
      const res = await request(server, '/health/live');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'alive' });
    });
  });

  // ── /health/ready — no checker (memory backend) ─────────────────────────

  describe('GET /health/ready (no checker / memory backend)', () => {
    it('returns 503 before setReady(true)', async () => {
      const res = await request(server, '/health/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'not ready' });
    });

    it('returns 200 after setReady(true)', async () => {
      setReady(true);
      const res = await request(server, '/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready' });
    });
  });

  // ── /health/ready — with checker (blob backend) ─────────────────────────

  describe('GET /health/ready (with readiness checker)', () => {
    it('returns 503 before startup completes even if checker would pass', async () => {
      setReadinessChecker(() => Promise.resolve());
      // isReady is false (startup has not completed)
      const res = await request(server, '/health/ready');
      expect(res.status).toBe(503);
    });

    it('returns 200 when startup is complete and checker passes', async () => {
      const checker = jest.fn().mockResolvedValue(undefined);
      setReadinessChecker(checker);
      setReady(true);
      const res = await request(server, '/health/ready');
      expect(res.status).toBe(200);
      expect(checker).toHaveBeenCalledTimes(1);
    });

    it('returns 503 when checker throws', async () => {
      setReadinessChecker(() => Promise.reject(new Error('storage unreachable')));
      setReady(true);
      const res = await request(server, '/health/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'not ready' });
    });

    it('caches a successful result for 30s (does not re-invoke checker)', async () => {
      const checker = jest.fn().mockResolvedValue(undefined);
      setReadinessChecker(checker);
      setReady(true);

      await request(server, '/health/ready');
      expect(checker).toHaveBeenCalledTimes(1);

      // Second call within TTL should use cached result
      const res2 = await request(server, '/health/ready');
      expect(res2.status).toBe(200);
      expect(checker).toHaveBeenCalledTimes(1);
    });

    it('caches a failed result for 30s', async () => {
      const checker = jest.fn().mockRejectedValue(new Error('fail'));
      setReadinessChecker(checker);
      setReady(true);

      await request(server, '/health/ready');
      expect(checker).toHaveBeenCalledTimes(1);

      const res2 = await request(server, '/health/ready');
      expect(res2.status).toBe(503);
      expect(checker).toHaveBeenCalledTimes(1);
    });

    it('re-invokes checker after cache expires', async () => {
      const checker = jest.fn().mockResolvedValue(undefined);
      setReadinessChecker(checker);
      setReady(true);

      let fakeNow = Date.now();
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

      await request(server, '/health/ready');
      expect(checker).toHaveBeenCalledTimes(1);

      // Advance past 30s TTL
      fakeNow += 31_000;

      await request(server, '/health/ready');
      expect(checker).toHaveBeenCalledTimes(2);

      spy.mockRestore();
    });

    it('recovers after a cached failure expires', async () => {
      let shouldFail = true;
      const checker = jest.fn().mockImplementation(() =>
        shouldFail ? Promise.reject(new Error('fail')) : Promise.resolve(),
      );
      setReadinessChecker(checker);
      setReady(true);

      let fakeNow = Date.now();
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

      // First call fails
      const res1 = await request(server, '/health/ready');
      expect(res1.status).toBe(503);

      // Fix the backend and advance past TTL
      shouldFail = false;
      fakeNow += 31_000;

      const res2 = await request(server, '/health/ready');
      expect(res2.status).toBe(200);

      spy.mockRestore();
    });
  });
});
