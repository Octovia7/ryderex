import { config } from '../../config';
import { BrevoEmailProvider } from './BrevoEmailProvider';
import { ConsoleEmailProvider } from './ConsoleEmailProvider';
import type { EmailProvider } from './EmailProvider';

export type { EmailProvider, SendOtpEmailParams } from './EmailProvider';

function createEmailProvider(): EmailProvider {
  if (config.brevo.apiKey && config.brevo.senderEmail) {
    return new BrevoEmailProvider();
  }

  console.warn('[email] BREVO_API_KEY not configured — falling back to ConsoleEmailProvider.');
  return new ConsoleEmailProvider();
}

export const emailProvider = createEmailProvider();
