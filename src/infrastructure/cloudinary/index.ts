import { CloudinaryDocumentProvider } from './CloudinaryDocumentProvider';
import type { DocumentProvider } from './DocumentProvider';

export type {
  DocumentProvider,
  UploadDocumentParams,
  UploadDocumentResult,
} from './DocumentProvider';

export const documentProvider: DocumentProvider = new CloudinaryDocumentProvider();

// The one place a stored document reference becomes a readable URL. Every read
// mints a fresh signed URL — nothing permanently usable is stored or returned —
// so callers (driver licences, vehicle documents, admin review) share this
// instead of each calling the provider directly.
export function toSignedDocumentUrl(publicId: string): string {
  return documentProvider.getSignedUrl(publicId);
}
