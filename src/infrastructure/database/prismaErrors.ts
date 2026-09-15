import { Prisma } from '../../generated/prisma/client';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asStringArray(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return null;
}

/**
 * Extracts the violated column(s) from a Prisma P2002 unique-constraint
 * error, returning null for anything else. Prisma 7's pg driver adapter
 * reports them at `meta.driverAdapterError.cause.constraint.fields` rather
 * than the older `meta.target` shape, so both are checked — otherwise a
 * duplicate key falls through as a raw 500 instead of a meaningful 409.
 */
export function getUniqueConstraintFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  if (error.code !== UNIQUE_CONSTRAINT_VIOLATION) {
    return null;
  }

  const meta = error.meta;
  if (!isRecord(meta)) {
    return null;
  }

  const target = asStringArray(meta.target);
  if (target) {
    return target;
  }

  const driverAdapterError = meta.driverAdapterError;
  const cause = isRecord(driverAdapterError) ? driverAdapterError.cause : undefined;
  const constraint = isRecord(cause) ? cause.constraint : undefined;
  const fields = isRecord(constraint) ? constraint.fields : undefined;

  return asStringArray(fields);
}
