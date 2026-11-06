import express, { Express } from 'express';
import cors from 'cors';
import { config } from './config';
import { client } from './db';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

const app: Express = express();

// Middleware
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check: sirve para monitoreo y como "ping" del keep-alive.
// La consulta `select 1` confirma que API + base de datos están vivas.
app.get('/api/health', async (_req, res) => {
  try {
    await client`select 1`;
    res.json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'error', timestamp: new Date().toISOString() });
  }
});

// Routes
app.use('/api', routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

export default app;
