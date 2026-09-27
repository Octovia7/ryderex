import { config } from '../../config';
import { AppError } from '../../shared/AppError';
import { BrevoEmailProvider } from './BrevoEmailProvider';
import { ConsoleEmailProvider } from './ConsoleEmailProvider';
import type { EmailProvider } from './EmailProvider';

export type { EmailProvider, SendOtpEmailParams } from './EmailProvider';

// Phase 15 (architecture.md's own fallback-safety table: "Email... No safe
// fallback — boot refuses"): ConsoleEmailProvider is fine in development,
// but silently degrading to it in production means every OTP is printed to
// stdout instead of delivered — broken login *and* credential disclosure.
// Development/test are unaffected; only NODE_ENV=production refuses to boot.
function createEmailProvider(): EmailProvider {
  if (config.brevo.apiKey && config.brevo.senderEmail) {
    return new BrevoEmailProvider();
  }

  if (config.isProduction) {
    throw new AppError({
      statusCode: 500,
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      message:
        'BREVO_API_KEY and BREVO_SENDER_EMAIL are required in production — refusing to fall back to ConsoleEmailProvider.',
    });
  }

  console.warn('[email] BREVO_API_KEY not configured — falling back to ConsoleEmailProvider.');
  return new ConsoleEmailProvider();
}

export const emailProvider = createEmailProvider();
