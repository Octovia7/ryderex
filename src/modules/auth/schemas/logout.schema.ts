import { z } from 'zod';

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
  allDevices: z.boolean().optional(),
});

export type LogoutInput = z.infer<typeof logoutSchema>;
