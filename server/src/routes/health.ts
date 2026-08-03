import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'listings-assistant-api',
    timestamp: new Date().toISOString(),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});
