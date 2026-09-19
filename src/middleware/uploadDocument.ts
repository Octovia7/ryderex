import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/AppError';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Magic-byte signatures — validated against the actual bytes, never the
// client-declared MIME type, which a renamed file can trivially spoof.
const SIGNATURES: { mimeType: string; magicBytes: number[] }[] = [
  { mimeType: 'image/jpeg', magicBytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', magicBytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'application/pdf', magicBytes: [0x25, 0x50, 0x44, 0x46] },
];

function matchesSignature(buffer: Buffer, magicBytes: number[]): boolean {
  if (buffer.length < magicBytes.length) {
    return false;
  }
  return magicBytes.every((byte, index) => buffer[index] === byte);
}

function detectFileType(buffer: Buffer): string | null {
  const match = SIGNATURES.find((signature) => matchesSignature(buffer, signature.magicBytes));
  return match ? match.mimeType : null;
}

// Shared by driver-license and (future) vehicle document uploads. Memory
// storage only — nothing is ever written to disk under a client-controlled
// name; the buffer is forwarded straight to the document provider.
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

export function validateDocumentMagicBytes(req: Request, _res: Response, next: NextFunction): void {
  const file = req.file;

  if (!file) {
    next(
      new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'A document file is required.',
      }),
    );
    return;
  }

  const detectedType = detectFileType(file.buffer);

  if (!detectedType) {
    next(
      new AppError({
        statusCode: 400,
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'Only JPEG, PNG, or PDF files are accepted.',
      }),
    );
    return;
  }

  next();
}
