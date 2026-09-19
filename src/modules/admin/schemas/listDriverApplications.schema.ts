import { z } from 'zod';

export const listDriverApplicationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).default('PENDING'),
});

export type ListDriverApplicationsQuery = z.infer<typeof listDriverApplicationsQuerySchema>;
