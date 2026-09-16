import type { EmailProvider, SendOtpEmailParams } from './EmailProvider';

// Development-only fallback. Printing an OTP to stdout is unsafe in any real
// environment — production boot must refuse to start without real Brevo
// credentials (deferred to the hardening phase; not yet enforced here).
export class ConsoleEmailProvider implements EmailProvider {
  async sendOtpEmail({ email, otp }: SendOtpEmailParams): Promise<void> {
    console.log(`[email:console] OTP for ${email}: ${otp}`);
    return Promise.resolve();
  }
}
