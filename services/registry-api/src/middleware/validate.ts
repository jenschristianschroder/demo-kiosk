import { Request, Response, NextFunction } from 'express';
import { Demo } from '../models';

const VALID_LAUNCH_MODES = ['sameTab', 'newTab', 'iframe'];

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateDemoBody(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Partial<Demo>;

  if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
    res.status(400).json({ error: 'title is required and must be a non-empty string' });
    return;
  }

  if (!body.demoUrl || !isValidUrl(body.demoUrl)) {
    res.status(400).json({ error: 'demoUrl is required and must be a valid HTTP(S) URL' });
    return;
  }

  if (body.launchMode && !VALID_LAUNCH_MODES.includes(body.launchMode)) {
    res.status(400).json({ error: `launchMode must be one of: ${VALID_LAUNCH_MODES.join(', ')}` });
    return;
  }

  if (body.tags && !Array.isArray(body.tags)) {
    res.status(400).json({ error: 'tags must be an array' });
    return;
  }

  if (body.healthCheckUrl && !isValidUrl(body.healthCheckUrl)) {
    res.status(400).json({ error: 'healthCheckUrl must be a valid HTTP(S) URL' });
    return;
  }

  next();
}
