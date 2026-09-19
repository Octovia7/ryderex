import { z } from 'zod';
import { VehicleDocumentType } from '../../../generated/prisma/enums';

// Sent as a multipart text field next to the file, e.g. `documentType=RC`.
export const uploadVehicleDocumentSchema = z.object({
  documentType: z.nativeEnum(VehicleDocumentType),
});

export type UploadVehicleDocumentInput = z.infer<typeof uploadVehicleDocumentSchema>;
