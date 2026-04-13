import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DemoStore } from '../store';
import { Demo } from '../models';
import { validateDemoBody } from '../middleware/validate';

export function createDemoRouter(store: DemoStore): Router {
  const router = Router();

  // GET /api/demos — list all demos (optionally filter by tag, active status)
  router.get('/', async (req: Request, res: Response) => {
    try {
      let demos = await store.getAllDemos();

      const tag = req.query.tag as string | undefined;
      if (tag) {
        demos = demos.filter((d) =>
          d.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        );
      }

      const activeOnly = req.query.active;
      if (activeOnly === 'true') {
        demos = demos.filter((d) => d.isActive);
      }

      res.json(demos);
    } catch (err) {
      console.error('Error fetching demos:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/demos/:id — get single demo
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const demo = await store.getDemoById(req.params.id as string);
      if (!demo) {
        res.status(404).json({ error: 'Demo not found' });
        return;
      }
      res.json(demo);
    } catch (err) {
      console.error('Error fetching demo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/demos — create demo
  router.post('/', validateDemoBody, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const demo: Demo = {
        id: uuidv4(),
        title: body.title.trim(),
        description: body.description?.trim() || '',
        demoUrl: body.demoUrl,
        thumbnailUrl: body.thumbnailUrl || '',
        tags: body.tags || [],
        launchMode: body.launchMode || 'sameTab',
        isActive: body.isActive !== undefined ? body.isActive : true,
        sortOrder: body.sortOrder ?? 0,
        owner: body.owner || '',
        lastVerifiedAt: body.lastVerifiedAt,
        healthCheckUrl: body.healthCheckUrl,
      };
      const created = await store.createDemo(demo);
      res.status(201).json(created);
    } catch (err) {
      console.error('Error creating demo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/demos/:id — update demo
  router.put('/:id', validateDemoBody, async (req: Request, res: Response) => {
    try {
      const updated = await store.updateDemo(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Demo not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      console.error('Error updating demo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PATCH /api/demos/:id — partial update
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const updated = await store.updateDemo(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Demo not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      console.error('Error updating demo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/demos/:id — delete demo
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await store.deleteDemo(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Demo not found' });
        return;
      }
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting demo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
