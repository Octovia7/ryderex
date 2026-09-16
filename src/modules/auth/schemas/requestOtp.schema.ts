import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
