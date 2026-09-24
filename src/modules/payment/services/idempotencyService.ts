import { randomUUID } from 'node:crypto';
import * as idempotencyRepository from '../repositories/idempotencyRepository';

// architecture.md §11's exact four outcomes:
//   first request             -> claim (INSERT), run handler, persist status + body
//   same key + same body      -> replay the stored response; handler never re-runs
//   same key + different body -> conflict
//   same key, still running   -> in_progress
export type EnforceOutcome =
  | { outcome: 'claimed'; id: string }
  | { outcome: 'conflict' }
  | { outcome: 'in_progress' }
  | { outcome: 'replay'; responseStatus: number; responseBody: unknown };

// Claims a request-hash for (userId, key), or reports why it couldn't. The
// claim itself is the database's own UNIQUE-constraint arbitration
// (idempotencyRepository.claim) — this function only decides what a LOST
// claim means, which the middleware cannot know from the claim result alone.
export async function enforce(
  userId: string,
  key: string,
  requestHash: string,
): Promise<EnforceOutcome> {
  const id = randomUUID();
  const won = await idempotencyRepository.claim(id, userId, key, requestHash);

  if (won) {
    return { outcome: 'claimed', id };
  }

  const existing = await idempotencyRepository.findByUserAndKey(userId, key);

  if (!existing) {
    // Vanishingly unlikely — nothing ever deletes an IdempotencyKey row, so
    // this would mean the losing claim raced a read that ran before the
    // winner's write was visible. Treated as in_progress rather than
    // crashing: safe (the client can simply retry), and it self-resolves the
    // moment the winner's write becomes visible.
    return { outcome: 'in_progress' };
  }

  if (existing.requestHash !== requestHash) {
    return { outcome: 'conflict' };
  }

  if (existing.responseStatus === null || existing.responseBody === null) {
    return { outcome: 'in_progress' };
  }

  return {
    outcome: 'replay',
    responseStatus: existing.responseStatus,
    responseBody: existing.responseBody,
  };
}

// Persists the handler's own response so a later identical request replays
// it verbatim rather than re-running the handler.
export function complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
  return idempotencyRepository.complete(id, responseStatus, responseBody);
}
