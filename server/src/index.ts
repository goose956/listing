import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aiRouter } from './routes/ai.js';
import { imagesRouter } from './routes/images.js';
import { healthRouter } from './routes/health.js';
import { emailRouter } from './routes/email.js';
import { extensionRouter } from './routes/extension.js';
import { adminRouter } from './routes/admin.js';
import { stripeRouter, stripeWebhookHandler } from './routes/stripe.js';

const app = express();
const PORT = process.env.PORT || 3001;

const explicitOrigins = process.env.CORS_ORIGIN?.split(',');
app.use(cors({
  origin: (origin, callback) => {
    // If CORS_ORIGIN is not set, allow all origins (single-dyno: frontend + API on same domain)
    if (!explicitOrigins) return callback(null, true);
    // Otherwise restrict to configured origins plus the Chrome extension
    if (!origin || explicitOrigins.includes(origin) || origin.startsWith('chrome-extension://')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Webhook needs raw body for Stripe signature verification — must be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use('/api/health', healthRouter);
app.use('/api/ai', aiRouter);
app.use('/api/images', imagesRouter);
app.use('/api/email', emailRouter);
app.use('/api/extension', extensionRouter);
app.use('/api/admin', adminRouter);
app.use('/api/stripe', stripeRouter);

// ---- Serve built client (single-dyno deploy) ----
// If client/dist exists, serve it as static files and fall back to index.html
// for client-side routing. This lets Railway host both API + frontend on one dyno.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — must come after API routes.
  // Middleware-based (not a route pattern) so it works on every Express version.
  // Exclude /api so unknown API paths return a JSON 404, not index.html.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`Serving client from ${clientDist}`);
} else {
  console.log('client/dist not found — API only. Build the client to serve the frontend.');
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Listings Assistant API running on http://localhost:${PORT}`);
});