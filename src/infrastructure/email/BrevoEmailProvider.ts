import { config } from '../../config';
import { AppError } from '../../shared/AppError';
import type { EmailProvider, SendOtpEmailParams } from './EmailProvider';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

export class BrevoEmailProvider implements EmailProvider {
  async sendOtpEmail({ email, otp }: SendOtpEmailParams): Promise<void> {
    const expiryMinutes = Math.floor(config.otp.ttlSeconds / 60);

    let response: Response;
    try {
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'api-key': config.brevo.apiKey ?? '',
        },
        body: JSON.stringify({
          sender: { email: config.brevo.senderEmail },
          to: [{ email }],
          subject: 'Your SaathiRide login code',
          textContent: `Your login code is ${otp}. It expires in ${expiryMinutes} minutes.`,
        }),
      });
    } catch (cause) {
      throw new AppError({
        statusCode: 502,
        code: 'EMAIL_SEND_FAILED',
        message: 'Failed to send the login code.',
        cause,
      });
    }

    if (!response.ok) {
      throw new AppError({
        statusCode: 502,
        code: 'EMAIL_SEND_FAILED',
        message: 'Failed to send the login code.',
        cause: { status: response.status, body: await response.text() },
      });
    }
  }
}
