import { z } from 'zod';

export const rejectDriverApplicationSchema = z.object({
  rejectionReason: z.string().trim().min(1),
});

export type RejectDriverApplicationInput = z.infer<typeof rejectDriverApplicationSchema>;
