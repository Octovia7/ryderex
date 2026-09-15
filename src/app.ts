import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'rydex-api',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
