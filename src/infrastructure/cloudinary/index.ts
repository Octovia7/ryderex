import { CloudinaryDocumentProvider } from './CloudinaryDocumentProvider';
import type { DocumentProvider } from './DocumentProvider';

export type {
  DocumentProvider,
  UploadDocumentParams,
  UploadDocumentResult,
} from './DocumentProvider';

export const documentProvider: DocumentProvider = new CloudinaryDocumentProvider();
