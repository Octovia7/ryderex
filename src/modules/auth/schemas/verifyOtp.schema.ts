import { z } from 'zod';

export const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  otp: z.string().regex(/^\d{6}$/, 'otp must be a 6-digit code'),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
