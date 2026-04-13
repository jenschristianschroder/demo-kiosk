import { Router, Request, Response } from 'express';
import { DemoStore } from '../store';

export function createSettingsRouter(store: DemoStore): Router {
  const router = Router();

  // GET /api/settings — get kiosk settings
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const settings = await store.getSettings();
      res.json(settings);
    } catch (err) {
      console.error('Error fetching settings:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/settings — update kiosk settings
  router.put('/', async (req: Request, res: Response) => {
    try {
      const updated = await store.updateSettings(req.body);
      res.json(updated);
    } catch (err) {
      console.error('Error updating settings:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
