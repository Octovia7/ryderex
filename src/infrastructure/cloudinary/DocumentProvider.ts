export interface UploadDocumentParams {
  buffer: Buffer;
  folder: string;
}

export interface UploadDocumentResult {
  publicId: string;
}

export interface DocumentProvider {
  uploadDocument(params: UploadDocumentParams): Promise<UploadDocumentResult>;
  getSignedUrl(publicId: string): string;
}
