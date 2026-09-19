import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { checkReadiness } from './infrastructure/health/checkReadiness';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { requestId } from './middleware/requestId';
import adminRoutes from './modules/admin/routes';
import authRoutes from './modules/auth/routes';
import userRoutes from './modules/user/routes';
import vehicleRoutes from './modules/vehicle/routes';

export function createApp(): Application {
  const app = express();

  // A hop count, never `true` — see config/env.ts's TRUST_PROXY comment.
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'saathiride-api',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness, unlike /health, exercises PostgreSQL and Redis on every call —
  // 200 only when both answer, otherwise the error handler's 503 envelope.
  app.get('/ready', async (_req, res) => {
    await checkReadiness();
    res.status(200).json({
      status: 'ready',
      service: 'saathiride-api',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/vehicles', vehicleRoutes);
  app.use('/api/v1/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
