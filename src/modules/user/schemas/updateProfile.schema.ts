import { z } from 'zod';

// Only these four fields are ever accepted — any other key (role, status,
// ratings, ...) is silently stripped by Zod's default non-strict parsing.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    profileImageUrl: z.string().url().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
