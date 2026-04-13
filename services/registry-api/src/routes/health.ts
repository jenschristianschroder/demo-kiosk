import { Router, Request, Response } from 'express';

const router = Router();

let isReady = false;

export function setReady(ready: boolean): void {
  isReady = ready;
}

router.get('/startup', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'started' });
});

router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

router.get('/ready', (_req: Request, res: Response) => {
  if (isReady) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready' });
  }
});

export default router;
