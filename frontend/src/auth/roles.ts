import type { User } from '../api/auth';

const VALID_ROLES: readonly User['role'][] = ['PASSENGER', 'DRIVER', 'ADMIN'];

export function isValidRole(value: unknown): value is User['role'] {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

// Where a successful login/registration lands, by the backend-assigned
// role. Self-registration always creates a PASSENGER (see
// src/modules/user/services/userService.ts createPassenger), so a brand
// new account falls out of the PASSENGER case here — no separate branch
// needed for "new user" vs. "returning passenger".
//
// DRIVER also lands on /app, not /driver: per docs/architecture.md's role
// table, a driver can do "all of the above [passenger capabilities], plus"
// post/manage rides — it's a superset, not a separate experience. /app is
// the shared hub that surfaces "Offer a ride" only for drivers; /driver is
// reached from there, not the landing page.
export function roleHomePath(role: User['role']): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'DRIVER':
    case 'PASSENGER':
      return '/app';
  }
}

// Passenger features (search, results, ride detail, the /app hub) are open
// to PASSENGER and DRIVER alike — a driver is still a passenger when they
// haven't posted a ride. ADMIN is excluded: per the role table, admin
// capability is "review licences and vehicle documents. Nothing else."
export function canAccessPassengerRoutes(role: User['role']): boolean {
  return role === 'PASSENGER' || role === 'DRIVER';
}

// Driver-only features (posting/managing rides) require the DRIVER role
// specifically — a PASSENGER who hasn't been approved can't reach them,
// and ADMIN doesn't get driver capability either.
export function canAccessDriverRoutes(role: User['role']): boolean {
  return role === 'DRIVER';
}

// Thrown when the backend hands back a session for a role this client
// doesn't recognize — never trust the role string blindly, even though it
// came from our own API, since a session must never be half-applied.
export class InvalidSessionError extends Error {
  constructor() {
    super('Received an account with an unrecognized role.');
    this.name = 'InvalidSessionError';
  }
}
