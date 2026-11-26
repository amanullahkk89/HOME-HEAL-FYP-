import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createHomeHealApp } from './server/app.ts';

async function start() {
  const { app, httpServer } = createHomeHealApp();
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`HomeHeal East-City Hospital server listening on http://0.0.0.0:${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start HomeHeal server:', err);
  process.exit(1);
});
