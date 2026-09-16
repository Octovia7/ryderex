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

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

// Prisma's default unique-index naming: `<table>_<column>_key`, where table
// and column are the physical (snake_case, via @map) names. Returned as the
// camelCase Prisma field name, so callers can compare against schema field
// names (e.g. "registrationNumber") regardless of which error shape fired.
function fieldFromIndexName(index: string, table: string): string | null {
  const prefix = `${table}_`;
  const suffix = '_key';
  if (!index.startsWith(prefix) || !index.endsWith(suffix)) {
    return null;
  }
  return snakeToCamel(index.slice(prefix.length, index.length - suffix.length));
}

/**
 * Extracts the violated column(s) from a Prisma P2002 unique-constraint
 * error, returning null for anything else.
 *
 * The canonical docs describe Prisma 7's pg driver adapter reporting fields
 * at `meta.driverAdapterError.cause.constraint.fields` (an array), but the
 * installed 7.10.0 release instead reports `constraint.index` (an index
 * name string, e.g. "users_phone_key") alongside `cause.table` — verified
 * directly against a real duplicate-key error, not assumed from the docs.
 * All three shapes (this one, the documented one, and the pre-driver-adapter
 * `meta.target` array) are checked, so a duplicate key never falls through
 * as a raw 500 instead of a meaningful 409.
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

  const fields = isRecord(constraint) ? asStringArray(constraint.fields) : null;
  if (fields) {
    return fields;
  }

  const index =
    isRecord(constraint) && typeof constraint.index === 'string' ? constraint.index : null;
  const table = isRecord(cause) && typeof cause.table === 'string' ? cause.table : null;

  if (index && table) {
    const field = fieldFromIndexName(index, table);
    return field ? [field] : null;
  }

  return null;
}
