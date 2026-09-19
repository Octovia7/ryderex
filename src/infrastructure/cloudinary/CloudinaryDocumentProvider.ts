import { v2 as cloudinary } from 'cloudinary';
import { config } from '../../config';
import { AppError } from '../../shared/AppError';
import type {
  DocumentProvider,
  UploadDocumentParams,
  UploadDocumentResult,
} from './DocumentProvider';

// JPEG, PNG and PDF (the only formats the upload middleware accepts) are all
// stored by Cloudinary as `image` assets, PDFs included. 'auto' is valid only
// as an upload instruction; delivery URLs need the concrete stored type, or
// they 404 (`Resource not found - auto/authenticated/...`).
const RESOURCE_TYPE = 'image';
const DELIVERY_TYPE = 'authenticated';

function isConfigured(): boolean {
  return Boolean(
    config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret,
  );
}

// No safe fallback exists for document storage (unlike email/push) — the
// canonical design has production boot refuse to start without real
// credentials. That boot assertion is deferred to the hardening phase; this
// provider instead throws clearly at call time when unconfigured, so local
// development without a Cloudinary account fails loudly rather than silently.
export class CloudinaryDocumentProvider implements DocumentProvider {
  constructor() {
    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true,
    });
  }

  uploadDocument({ buffer, folder }: UploadDocumentParams): Promise<UploadDocumentResult> {
    if (!isConfigured()) {
      return Promise.reject(
        new AppError({
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Document storage is not configured.',
        }),
      );
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: RESOURCE_TYPE,
          type: DELIVERY_TYPE,
          unique_filename: true,
          use_filename: false,
          overwrite: false,
        },
        (error, result) => {
          if (error || !result) {
            reject(
              new AppError({
                statusCode: 502,
                code: 'DOCUMENT_UPLOAD_FAILED',
                message: 'Failed to upload the document.',
                cause: error,
              }),
            );
            return;
          }

          resolve({ publicId: result.public_id });
        },
      );

      uploadStream.end(buffer);
    });
  }

  getSignedUrl(publicId: string): string {
    if (!isConfigured()) {
      throw new AppError({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Document storage is not configured.',
      });
    }

    // Genuine expiry needs Cloudinary's Auth Token feature: a distinct key
    // from the base API credentials, and the account's own "Strict
    // transformations" / Auth Token security setting enabled in the
    // Cloudinary dashboard — account-side configuration this app cannot set.
    // Without that key configured, the URL is still cryptographically
    // signed (tamper-proof) but does not expire — a lesser, clearly-flagged
    // fallback, not a silent substitute for the documented requirement.
    if (config.cloudinary.authTokenKey) {
      return cloudinary.url(publicId, {
        type: DELIVERY_TYPE,
        resource_type: RESOURCE_TYPE,
        secure: true,
        sign_url: true,
        auth_token: {
          key: config.cloudinary.authTokenKey,
          duration: config.cloudinary.signedUrlTtlSeconds,
        },
      });
    }

    return cloudinary.url(publicId, {
      type: DELIVERY_TYPE,
      resource_type: RESOURCE_TYPE,
      sign_url: true,
      secure: true,
    });
  }
}
