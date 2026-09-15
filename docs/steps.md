# SaathiRide — Engineering Log

How SaathiRide was built: the order the system came together in, what each stage
turned out to require, and the bugs that changed the design along the way.

This is the project's history and forward roadmap. For how the system is
designed today, see [`docs/architecture.md`](./architecture.md); for the
rules that constrain changes to it, see [`claude.md`](./claude.md).

---

## Status

```
Phases 0–15   COMPLETE     backend implemented and verified at runtime
Phase 16      NEXT         deployment (Render + Supabase + Upstash)
Phase 17      BLOCKED      end-to-end verification of the deployment
```

Every completed phase below is **implemented and runtime-verified, but not
guarded by automated tests**. Phase 15 was closed by two full manual
verification passes rather than by building a test suite — §16 records exactly
what that does and does not mean.

There is no test framework, no `test` script, no structured logger, no metrics,
no OpenAPI spec, no Dockerfile, and no CI in this repository. Nothing below
should be read as claiming otherwise; the gaps are tracked in §19.

## Why it was built in this order

The sequence is driven by dependency, not by feature priority. Each stage exists
because the next one could not have been built without it:

```
foundation ──▶ database ──▶ auth ──▶ identity & trust ──▶ supply
                                                            │
                                    demand ◀── discovery ◀───┘
                                      │
                                      ▼
                                    money ──▶ async delivery ──▶ hardening
```

- **Auth before everything** — every other module needs an authenticated user id,
  and ownership checks are meaningless without one.
- **Trust before supply** — a driver cannot post a ride until there is a way to
  become a driver and to verify a vehicle, so licence and vehicle review had to
  precede ride creation.
- **Supply before discovery** — there is nothing to search until rides exist.
- **Discovery before demand** — a booking needs a ride the passenger can find.
- **Demand before money** — the seat hold defines what a payment is *for*.
- **Money before async delivery** — refunds and settlement generate most of the
  events worth notifying about.

Two stages arrived out of their planned order, both for real reasons recorded in
§18: BullMQ was introduced during Booking rather than Notifications (seat-hold
expiry needs a delayed job and cannot be built without one), and the payment
provider abstraction was stood up during Ride creation rather than Payments
(ride creation needs something behind `createOrder()` to persist against).

---

## 1. Foundation and database (Phases 0–2)

The first three stages produced no business logic at all — deliberately. They
established the TypeScript/Express/Prisma skeleton, Docker Compose for
PostgreSQL + PostGIS and Redis, ESLint/Prettier, startup environment validation
that exits non-zero on bad config, centralised error handling, request ids, and
`/health` + `/ready`.

The database stage modelled only the entities whose design was already settled —
`User`, `RefreshToken`, `UserDocument`, `Vehicle`, `VehicleDocument` — and left
`Ride`, `Booking`, `Payment` and the rest to the phases that would actually use
them. That restraint mattered later: every model that arrived subsequently did so
with a concrete query pattern already in hand, which is why the index list is
short and every entry earns its place.

Two decisions from this stage propagate through the whole codebase: UUID primary
keys everywhere (so no resource is enumerable by incrementing a path segment),
and `Decimal(10,2)` plus `Timestamptz(3)` as the defaults for money and time.

## 2. Authentication (Phase 3)

Passwordless OTP login, backed by Redis, with short-lived access tokens and
rotating refresh tokens.

The design choices worth calling out: OTPs are bcrypt-hashed before they touch
Redis and never logged; a failed attempt re-writes the record with the
*remaining* TTL so guessing cannot extend the window; refresh tokens are opaque
random bytes stored only as a SHA-256 hash, so a database leak yields nothing
usable; and presenting an already-revoked refresh token revokes the entire token
family rather than just that token.

One implementation detail took a second attempt to get right. Rotation runs
inside a transaction, and the reuse path needs to *write* (revoking the family)
before rejecting the request. Throwing inside a Prisma interactive transaction
rolls back everything written in it — including that revocation. The function
therefore returns a result variant from the transaction and throws only after it
has committed.

## 3. User profile (Phase 4)

Profile read and update, scoped so a user can only ever touch their own record —
the id comes from the access token, never from the request body or params, so no
separate authorization rule was needed.

## Status: complete

Implemented `GET /api/v1/users/me` and `PATCH /api/v1/users/me`, both
behind the existing `authenticate` middleware (no separate authorization
rule needed — every user may only ever read/write their own profile, since
the id comes from the access token, never the request body/params).

`PATCH` accepts `name`, `phone`, `email`, `profileImageUrl` only; the zod
schema silently strips any other key (`role`, `status`, `ratingAverage`,
`ratingCount`, ...), and `.refine()` rejects an empty body. A dedicated
"profile image abstraction" was not built — Cloudinary integration is
Phase 5's job; for now `profileImageUrl` just accepts a URL string
directly, matching what the current schema can actually store.

## Real bug found and fixed during manual verification

Manually exercising the duplicate-email/duplicate-phone path (no
automated test infra yet, per the Phase 3 note) surfaced a bug that
predates this phase: `authService.isUniquePhoneViolation` — and the
equivalent check written for this phase's `userService.updateProfile`
— assumed Prisma's older `err.meta.target: string[]` shape for P2002
unique-constraint errors. Prisma 7's pg driver adapter reports the
violated column(s) at `err.meta.driverAdapterError.cause.constraint.fields`
instead; `target` is no longer set. Both checks silently failed closed,
so duplicate phone/email fell through as raw `INTERNAL_ERROR` 500s
instead of `PHONE_ALREADY_IN_USE` / `EMAIL_ALREADY_IN_USE` 409s.

Fixed once, centrally, in `src/infrastructure/database/prismaErrors.ts`
(`getUniqueConstraintFields`), which checks both shapes so it keeps
working across driver-adapter versions. Both `authService.ts` and the
new `userService.ts` now call it instead of duplicating driver-specific
error parsing. Verified against the real Postgres container: duplicate
email on `PATCH /users/me` → 409 `EMAIL_ALREADY_IN_USE`; duplicate phone
on `PATCH /users/me` → 409 `PHONE_ALREADY_IN_USE`; duplicate phone on
signup (`POST /auth/verify-otp`) → 409 `PHONE_ALREADY_IN_USE` (previously
500). Also verified: `GET /users/me` without a token → 401; role/rating
fields silently stripped from `PATCH` body; empty `PATCH` body → 400.

------------------------------------------------------------------------

## 4. Driver upgrade via licence verification (Phase 4.5)

This phase existed because Phase 3 exposed a gap that blocked everything
downstream: every signup lands as `PASSENGER`, and there was no path to
`DRIVER`, so ride creation could never be reached end to end.

Rather than add a self-serve role switch — which would make the role meaningless
— a passenger now submits a driving licence, and only an admin approval flips
the role. Approval is a single conditional update that sets `role = DRIVER` and
`driverLicenseStatus = VERIFIED` together, guarded on the row still being
`PENDING`, so two admins approving simultaneously produce exactly one approval.

The role change propagates without any extra mechanism: refresh-token rotation
already re-reads the role from the database, so the user's next refresh issues a
token reflecting it.

## Status: complete

Implemented as described above: `UserDocumentType`/`DriverLicenseStatus`
enums and the four `driverLicense*` fields on `User` (migration
`20260811082340_driver_license_verification`); a `CloudinaryDocumentProvider`
behind a `DocumentProvider` interface (`src/infrastructure/cloudinary/`),
uploading with Cloudinary's `authenticated` delivery type and generating
short-lived signed URLs on read rather than storing a permanently-usable
link; a multer + magic-byte upload middleware
(`src/app/middleware/uploadDocument.ts`) shared with Phase 5's vehicle
documents; `POST /api/v1/users/me/driver-application`; and the first slice
of the Admin Module (`src/modules/admin/`) with `GET|POST
/api/v1/admin/driver-applications...`.

Verified end-to-end against the real Postgres/Cloudinary containers/account
(no automated test infra yet, per the Phase 3 note): submit → 200 PENDING;
resubmit while PENDING → 409 `DRIVER_APPLICATION_PENDING`; non-admin hitting
`/admin/driver-applications` → 403; admin list returns a working signed
Cloudinary URL that was fetched and confirmed to be the real uploaded file;
verify → role flips `PASSENGER → DRIVER` and `driverLicenseStatus →
VERIFIED`; verifying an already-decided application → 409
`DRIVER_APPLICATION_NOT_PENDING`; verifying a nonexistent user → 404
`USER_NOT_FOUND`; the pre-existing access token issued before approval
still decoded to `role: PASSENGER`, and `POST /auth/refresh` correctly
issued a new token with `role: DRIVER` (confirms spec §8's claim about
`tokenService` re-reading role on rotation, without needing new code);
reject without `rejectionReason` → 400; reject with a reason → 200, and
`GET /users/me` reflected `REJECTED` + the reason; resubmitting after
rejection succeeded and cleared the stale rejection reason back to `null`;
an invalid `?status=` query on the admin list endpoint → 400. A fake `.png`
that was actually plain text was correctly rejected by the magic-byte check
(client-sent MIME type alone would have let it through).

One real bug found during this verification, unrelated to the code above:
`.env`'s `CLOUDINARY_CLOUD_NAME` was set to the dashboard display name
("SaathiRide") rather than the actual lowercase cloud slug, which Cloudinary's
SDK rejects outright. Not a code defect — flagged to the user, who
corrected `.env`.

------------------------------------------------------------------------

## 5. Vehicles and documents (Phase 5)

Vehicle registry plus RC / insurance / pollution document upload to Cloudinary.

Documents are validated by magic bytes rather than the client-declared MIME type,
capped at 5 MB, and stored with Cloudinary's `authenticated` delivery type — so
the stored URL is not publicly fetchable and every read generates a fresh signed
URL. There is deliberately no permanently-usable link to anyone's driving licence
in the system. Only vehicle *creation* carries a role gate; everything else is
scoped by ownership in the service layer, returning 404 rather than 403 so
another driver's vehicle existence never leaks.

## Status: complete

Implemented `POST /vehicles`, `GET /vehicles`, `GET /vehicles/:id`, `PATCH
/vehicles/:id`, and `POST /vehicles/:id/documents`
(`src/modules/vehicle/`). Creation is gated to `DRIVER` via
`authorize('DRIVER')`; read/update/document-upload are scoped by ownership
in the service layer (every vehicle owner is already a `DRIVER` by
construction, so no extra role check is needed there). Registration
numbers are normalized (uppercased, whitespace/hyphens stripped) before
the uniqueness check, so `"KA 01 AB 1234"` and `"ka01ab1234"` collide as
expected. Document uploads reuse Phase 4.5's Cloudinary provider and
upload middleware — no duplicated upload/signing logic.

Verified end-to-end against the real Postgres/Cloudinary containers:
`PASSENGER` blocked from `POST /vehicles` → 403; created a vehicle as a
freshly-approved `DRIVER`; duplicate (normalized) registration number →
409 `REGISTRATION_NUMBER_ALREADY_IN_USE`; `GET`/`PATCH` round-tripped
correctly, including a client attempt to set the server-controlled
`verificationStatus` being silently stripped rather than erroring;
uploaded an RC document and confirmed it appears in the vehicle's
`documents` array with a working signed URL; a second driver got 404
(not 403) on another driver's vehicle by id, by PATCH, and saw an empty
list from `GET /vehicles` — ownership boundaries hold and existence isn't
leaked across drivers.

Not built in this phase (intentionally out of scope, tracked separately):
Phase 5.5's admin vehicle-verification endpoints, and Phase 7's ride
creation eligibility check that will consume `verification_status`.

------------------------------------------------------------------------

## 6. Admin verification (Phase 5.5)

A deliberately narrow admin module: review driving licences, review vehicle
documents, and nothing else. No user management, no ride or booking overrides, no
financial actions.

Admins are provisioned by seed script or manual insert — never self-registered —
and authenticate through the same OTP flow as everyone else. `ADMIN` is a third
value on the existing role column, not a parallel auth system.

## Status: complete

No migration was needed — `vehicles.verified_by`/`verified_at`/
`rejection_reason` already existed from the Phase 2 init migration. This
phase was pure application layer: `GET /admin/vehicles?status=PENDING`,
`GET /admin/vehicles/:id`, `POST /admin/vehicles/:id/verify`, `POST
/admin/vehicles/:id/reject` (`src/modules/admin/`), reusing the
`authorize('ADMIN')` middleware and admin routing already set up in Phase
4.5 exactly as planned — no new admin plumbing.

The verify/reject repository functions use the same conditional-update
pattern as Phase 4.5's driver-license decision (`UPDATE ... WHERE id = ?
AND verification_status = 'PENDING'`), so two concurrent admin decisions
on the same vehicle can't both apply (spec §58).

While building this, the document-signing snippet
(`documentProvider.getSignedUrl` + `extractFormatFromSecureUrl`) had
already been written twice — once for driver licenses, once for vehicle
documents — so it was pulled into a shared `toSignedDocumentUrl` helper in
`src/infrastructure/cloudinary/index.ts` and both existing call sites were
switched over. The admin vehicle service also reuses Phase 5's exported
`toVehicleDto`/`toDocumentDto` mappers rather than re-deriving the vehicle
DTO shape a third time.

Verified end-to-end against the real Postgres/Cloudinary containers/account
(no automated test infra yet, per the Phase 3 note): a `DRIVER` (not
`ADMIN`) hitting `/admin/vehicles` → 403; admin lists two pending vehicles
(one with an uploaded RC document, whose signed URL round-tripped
correctly) alongside owner contact details; `GET /admin/vehicles/:id`
returns the same shape for a single vehicle; verify → `VERIFIED` with
`verified_by` correctly set to the admin's own id (confirmed directly in
Postgres) and reflected on the owner's own `GET /vehicles`; verifying an
already-decided vehicle → 409 `VEHICLE_NOT_PENDING`; reject without a
`rejectionReason` → 400; reject with a reason → `REJECTED` with the reason
stored and visible to the owner; verify/reject on a nonexistent vehicle →
404 `VEHICLE_NOT_FOUND`; an invalid `?status=` query → 400.

Not built in this phase (out of scope, tracked separately): Phase 7's ride
creation eligibility check that will actually read `verification_status`
to decide ride-creation eligibility — there is no ride module yet for it
to gate.

------------------------------------------------------------------------

## 7. Map provider and fare engine (Phase 6)

The first two provider abstractions: `MapProvider` for geocoding, routing and
distance matrices, and `FareStrategy` for pricing.

The map provider changed before a line of it was written. Mapbox — the
originally chosen vendor — began requiring a payment method before any free-tier
usage, which conflicted with a hard constraint of no card on file with a mapping
vendor. Geoapify replaced it after comparing eight alternatives on free-tier
limits, commercial-use terms and coverage. Because the domain depends only on the
interface, this was a provider swap rather than a redesign.

The fare formula is `(baseFare + km × pricePerKm)` scaled by bounded multipliers
for vehicle type, traffic and driver rating. Every multiplier is bounded on
purpose: they compose multiplicatively, so a single unbounded one is a pricing
incident. Driver rating can move a fare by at most ±5%.

## Status: complete

Implemented `MapProvider` (`src/infrastructure/maps/mapProvider.ts`) —
`geocode`/`reverseGeocode`/`getRoute`/`getDistanceMatrix`, exactly as
specified in spec §17 — with `GeoapifyMapProvider` as the concrete
implementation (`src/infrastructure/maps/geoapifyMapProvider.ts`), wired
up via a factory (`src/infrastructure/maps/index.ts`) that switches on a
new `MAP_PROVIDER` env var, mirroring the existing Resend/Cloudinary
factory pattern. **Geoapify replaces the originally-planned Mapbox** —
see spec §17/§97 (2026-08-12) for the full reasoning: Mapbox's
signup now requires a card, which conflicts with an explicit
no-payment-method constraint; Geoapify was chosen after comparing it
against OpenRouteService, LocationIQ, MapTiler, and self-hosted
OSRM+Nominatim.

Also implemented the Fare engine under a new `ride` module (only its
`strategies/`/`services/` slice — controllers/routes/repositories are
Phase 7's job): `FareStrategy` interface + `HeuristicFareStrategy`
(`src/modules/ride/strategies/`) implementing spec §29's formula
(`baseFare + distanceKm * pricePerKm`, then bounded vehicle/traffic/
rating multipliers — rating multiplier is linearly interpolated between
configured min/max bounds across the 1-5 rating range, per §29's
"driver-rating influence must be bounded"), and `calculateFare()`
(`src/modules/ride/services/fareService.ts`) as the single call site the
future Ride module will use, taking an injectable `FareStrategy` for
testability. All fare inputs (base fare, price/km, per-`VehicleType`
multipliers, traffic/rating multiplier bounds) are new `FARE_*` env vars
— nothing hard-coded, per §29/§85.

No automated test infra exists yet (per the Phase 3 note), so this was
verified manually with a temporary script exercising the real Geoapify
API and the real fare formula end-to-end (deleted after verification,
not committed): geocode/reverseGeocode/getRoute/getDistanceMatrix all
returned correctly-shaped real results for Bangalore addresses
(Koramangala, Whitefield, Jayanagar); a nonexistent address correctly
threw `GEOCODE_NOT_FOUND` instead of silently returning nothing; fare
calculations were checked by hand against the formula for a ~22km
sedan/hatchback ride (multiplier ratio matched exactly), a 5-star SUV
ride with high traffic input (rating and traffic multipliers both
applied and matched hand-calculated values), a 1-star sedan ride
(multiplier correctly pulled fare down, not up), an intentionally
out-of-range traffic multiplier (999) to confirm clamping actually
clamps to the configured max rather than exploding the fare, and a
zero-distance ride (fare correctly reduces to exactly the base fare).
`npm run typecheck`, `npm run lint`, and `npm run build` all pass.

Not built in this phase (intentionally, per §10 (Booking)'s own scope and
spec §87): no ride HTTP endpoints, no ride persistence, no map
matching (spec §17 interface still has no `mapMatch` method — no
current requirement drives adding one), no map-tile/rendering concern
(that's a frontend SDK choice, outside `MapProvider` entirely). Phase 7
consumes both `mapProvider` and `calculateFare()` when ride creation is
built.

------------------------------------------------------------------------

## 8. Ride creation and lifecycle (Phase 7)

Ride creation, the ride state machine, and the driver's 5% posting commission.

Two things fell out of this phase that were not in the original plan. First, the
ride needed a `PENDING_PAYMENT` state: a ride costs its driver a commission,
payment confirmation is webhook-driven and therefore asynchronous, so a ride
cannot become searchable inside the same request that created it. Second, the
payment provider abstraction had to be stood up here rather than in the Payments
phase, because ride creation needs something behind `createOrder()` to persist an
order reference against.

The creation flow settled the ordering rule the rest of the codebase follows:
every external call — routing, then order creation — happens *before* the single
database transaction, never inside it.

## Status: complete

Implemented all five endpoints (`src/modules/ride/`). Notable
architectural gap found and closed along the way: Phase 6 was supposed to
stand up `PaymentProvider` (steps.md Phase 6 goal explicitly lists it
alongside MapProvider/FareStrategy) but only built the latter two. Ride
creation's flow (step 12: "create payment order for posting commission")
needs a real call site, so this phase added the interface +
`StubPaymentProvider` (`src/infrastructure/payments/`) that Phase 6
should have included — see spec §37 (2026-08-12). It generates a
locally-referenced order id, not a real charge; Phase 10 swaps in
`RazorpayProvider` behind the same interface.

New `Ride` Prisma model (migration `20260812123854_ride_creation`):
`origin`/`destination` are `Unsupported("geography(Point,4326)")` since
Prisma Client has no native geography type, so the ride repository
(`src/modules/ride/repositories/rideRepository.ts`) reads/writes them via
raw SQL (`Prisma.sql`/`Prisma.raw`, spec §77) using
`ST_MakePoint`/`ST_X`/`ST_Y` — every other column (including the
`PENDING_PAYMENT`/`OPEN`/`FULL`/`STARTED`/`COMPLETED`/`CANCELLED` status
transitions) goes through the normal Prisma Client API. GiST indexes on
`origin`/`destination` were hand-added to the generated migration SQL
(spec §16) since Prisma can't declare `@@index` on an `Unsupported`
field.

Vehicle eligibility for ride creation (ownership + `ACTIVE` +
`VERIFIED` + seat capacity, spec §8/§97) lives in one function,
`assertVehicleEligibleForRide`
(`src/modules/ride/services/vehicleEligibilityService.ts`), reused as
spec §96 says it should be. Commission calculation
(`src/modules/ride/services/commissionService.ts`) centralizes the 5%
posting-fee formula (§30) in one place. Every external call
(`MapProvider.getRoute`, `PaymentProvider.createOrder`) happens before
the single ride INSERT — no external call sits inside a DB transaction
(§5.5).

Not built in this phase, intentionally deferred: cancellation
refunds/booking-cascade (Phase 11 — no Booking/Payment/Transaction
tables exist yet), the actual `PENDING_PAYMENT -> OPEN` webhook
transition (Phase 10 — no way to reach `OPEN` in this phase except a
direct DB update for testing), ride search (Phase 8).

Verified end-to-end against the real Postgres/Geoapify/Cloudinary stack
(no automated test infra yet, per the Phase 3 note; dev server run with
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` temporarily blanked so OTPs logged
to console instead of emailing, since a real Resend key is configured in
this environment's `.env`): took a `PASSENGER` through the full
driver-license approval flow to `DRIVER`, confirmed the refreshed access
token carries the new role (mirrors the Phase 4.5 verification of the
same claim), created and admin-verified a vehicle, then created a real
ride — Geoapify returned a real 19.7 km / ~18.5 min route between
Koramangala and Whitefield, fare computed to ₹188/seat (hatchback), and
posting commission to ₹28 (188 × 3 seats × 5%, rounded), matching hand
calculation exactly; geography columns round-tripped correctly
(confirmed via `ST_X`/`ST_Y` directly in Postgres). Verified: a
`PASSENGER` creating a ride → 403 `FORBIDDEN`; a past `departureTime` →
400 `VALIDATION_ERROR`; seats exceeding vehicle capacity → 409
`VEHICLE_NOT_ELIGIBLE`; a nonexistent vehicle → 404 `VEHICLE_NOT_FOUND`;
an unverified (`PENDING`) vehicle → 409 `VEHICLE_NOT_ELIGIBLE`; `GET
/rides/:id` by a non-owner passenger succeeds (rides are readable by
anyone, unlike vehicles); a non-owner calling `/cancel` gets 404 (not
403 — ownership existence isn't leaked, same pattern as vehicles);
`start` on a `PENDING_PAYMENT` ride → 409 `INVALID_RIDE_STATE`;
`complete` before `start` → 409; a full happy-path lifecycle
(`PENDING_PAYMENT` →manual DB flip→ `OPEN` → `start` → `STARTED` →
`complete` → `COMPLETED`) succeeded, with a second `start` call on the
now-`STARTED` ride correctly rejected; cancelling an already-`CANCELLED`
or `COMPLETED` ride both correctly rejected with 409. `npm run
typecheck`, `npm run lint`, and `npm run build` all pass.

------------------------------------------------------------------------

## 9. Ride search and PostGIS (Phase 8)

The core discovery query, and the phase with the most careful SQL in the project.

A passenger searches by pickup point, drop point and calendar date — no time
range. The whole match is one PostGIS query: the date becomes a half-open UTC
range so the `(departure_time, status)` index applies, two `ST_DWithin` calls do
GiST-accelerated radius filtering on `geography(Point,4326)` columns, and
`ST_Distance` computes exact spheroid distances only for the rows that survive.

Three choices here are load-bearing. `geography` rather than `geometry`, because
`geometry` at SRID 4326 returns degrees rather than metres. Filtering in the
database rather than in Node, because application-side filtering cannot use an
index and breaks pagination — `LIMIT` has to apply after filtering and sorting.
And the map provider is never called during search; it is for routing and
geocoding, not discovery.

Sorting maps a validated enum to one of five fixed SQL expressions, always with
`id` as a tie-breaker so keyset pagination cannot skip or repeat rows.

## Status: complete

Implemented `GET /api/v1/rides/search` (`src/modules/ride/`), registered
before `GET /:id` in the router since Express would otherwise match
`search` as the `:id` param. Query params: `date`, `pickupLat/Lng`,
`destinationLat/Lng`, `sort` (default `DEPARTURE_TIME`), `cursor`,
`limit` — validated by a new `validateQuery` middleware
(`app/middleware/validate.ts`) that stores the coerced result on
`req.validatedQuery` rather than reassigning `req.query`, since Express 5
makes `req.query` a getter-only property (confirmed directly in
`express/lib/request.js` before writing this — reassigning it throws).

`rideSearchRepository.search()` is one hand-written raw-SQL query
(spec §77) joining `rides`/`vehicles`/`users`, using
`ST_DWithin`/`ST_Distance` for the 10km radius match and distance
sorting (never JS distance math, never a per-result MapProvider call —
§23). The date filter converts the requested Asia/Kolkata calendar date
into a UTC `[start, end)` range (`utils/kolkataDate.ts`) — a hardcoded
`+05:30` offset is correct here specifically because India has used a
single fixed offset with no DST since 1945, not a general timezone
shortcut. Sort options map through a fixed internal switch
(`sortExpression`) to one of five whitelisted SQL fragments — the client
only ever sends the enum value, never SQL (§25). Cursor pagination
(§26) is keyset-based: `(sortExpr, id) > (cursorValue, cursorId)`,
base64url-encoded JSON, rejected with `INVALID_CURSOR` if malformed or
minted for a different sort order than the current request. `available_seats
> 0 AND status IN ('OPEN','FULL')` remains the authoritative "bookable"
condition (§22 — `FULL` alone isn't sufficient). `DRIVER_RATING` sorts
via `COALESCE(u.rating_average, 6)` so an unrated driver sorts last
without breaking the keyset comparison (a `NULL` in a row-comparison
tuple isn't a total order).

Verified against the real Postgres/PostGIS container with 17 seeded
rides at precisely controlled distances (computed via an equirectangular
offset from a fixed reference point — accurate to well under 1km at this
scale, more than enough margin for 10km-boundary tests) and precisely
controlled dates/status/seats/fares (created through the real
`POST /rides` endpoint, then adjusted via direct SQL for the scenarios
the HTTP API can't produce yet — `OPEN` status, since Phase 10's webhook
doesn't exist; specific fares/times/seat counts for deterministic sort
tests): origin exactly inside (9900m) vs exactly outside (10100m) the
10km radius; same for destination; both-inside, one-outside (both
directions), and both-outside combinations; a ride on the wrong date
correctly excluded; zero-seats and `CANCELLED` rides correctly excluded;
all 9 genuinely-matching rides returned. All five sort orders verified
correct against hand-computed expected orderings, including three- and
seven-way ties resolved by ascending `id` exactly as predicted (`DEPARTURE_TIME`
and `PICKUP_DISTANCE` ties; a `DRIVER_RATING` sort where every ride
shared the same driver, so the entire result fell back to pure
id-ascending order — a stronger tie-break test than a partial tie).
Cursor pagination walked all 5 pages at `limit=2` sorted by `FARE`,
correctly splitting a tied pair (150, 150) across a page boundary with
no duplicate or missing rows across 9 total items. Verified error paths:
malformed cursor and a cursor minted under a different sort → 400
`INVALID_CURSOR`; invalid date format and missing required query params →
400 `VALIDATION_ERROR`; `limit=1000` silently clamped to
`RIDE_SEARCH_MAX_LIMIT` rather than erroring; missing auth → 401.
`EXPLAIN ANALYZE` against the real search query confirmed `Bitmap Index
Scan` on both `rides_origin_gist` and `rides_destination_gist` (combined
via `BitmapAnd` with the `departure_time`/`status` btree index) — the
spatial GiST indexes are actually used, not sequentially scanned. `npm
run typecheck`, `npm run lint`, and `npm run build` all pass.

------------------------------------------------------------------------

## 10. Booking and seat concurrency (Phase 9)

The phase the whole system's correctness rests on.

The seat hold *is* the `PENDING_PAYMENT` booking row — there is no Redis counter
and no separate reservation table. `available_seats` decrements at booking
creation, not at payment confirmation, because holding at confirmation lets two
passengers both reach a payment screen for the same last seat and turns a clean
409 into a refund.

The mechanism is a single conditional `UPDATE` whose `WHERE` clause carries the
seat guard. PostgreSQL takes a row lock for the statement's duration, so a
concurrent update blocks and then re-evaluates its guard against the committed
value — returning zero rows and a `409`. There is no read-then-write window to
lose, which is why this is one statement rather than `SELECT … FOR UPDATE`
followed by a check and an update.

This phase also forced BullMQ into the project three phases earlier than planned:
a seat hold has to expire if payment never completes, and there is no way to
build that without a delayed job.

## Status: complete

Implemented all three endpoints (`src/modules/booking/`): `POST
/rides/:id/bookings` is registered on `rideRouter`
(`src/modules/ride/routes.ts`) per spec §51's nesting, but its
controller/service/repository all live in the booking module — routing
is the only thing that crosses the module boundary, same pattern
`admin/routes.ts` already established. `GET /bookings/:id` and `POST
/bookings/:id/cancel` are a new `bookingRouter` mounted at
`/api/v1/bookings`.

Two real architectural gaps found and closed along the way, both
documented in the decision log (§18) (2026-08-13):

-   §32 listed `booking_status` and `payment_status` as two separate
    columns, but §33's actual state list describes one lifecycle, not
    two — resolved to a single `status` column, matching the precedent
    Ride already set (§19). Schema/architecture doc updated to match.
-   Phase 9's seat-hold expiry requires a BullMQ delayed job, but no
    BullMQ infrastructure exists yet (it was sequenced for Phase 12).
    Added `bullmq` + `src/infrastructure/queue/` now — a dedicated
    ioredis connection (`maxRetriesPerRequest: null`, required by
    BullMQ, kept separate from `infrastructure/redis`'s rate-limiting
    connection) and one `booking-expiry` queue. The Worker runs inside
    the same process as the API server for now (§66: this doesn't
    break statelessness — Redis holds all job state, any instance can
    pick up any job) and is started/closed alongside the HTTP server in
    `server.ts`. Phase 12 reuses this same queue infrastructure.

Seat reservation (spec §36) is one atomic conditional `UPDATE`
(`rideRepository.reserveSeats`) — `available_seats = available_seats -
N WHERE status IN ('OPEN','FULL') AND available_seats >= N`, in the same
statement flipping `OPEN -> FULL` when a booking exhausts the last seat.
This is the "SELECT ride FOR UPDATE + check + decrement" sequence from
the spec collapsed into one statement — a real Postgres row lock is
still held for the statement's duration, just expressed as a guarded
UPDATE rather than a separate SELECT FOR UPDATE, the same idiom already
used for `rideRepository.cancel/start/complete` (§58). This UPDATE and
the booking `INSERT` run inside one `prisma.$transaction`; the
`PaymentProvider.createOrder()` call for the 10% prepayment (reusing the
same `StubPaymentProvider` from Phase 7, per §37) happens *after* that
transaction commits, then a follow-up single-row update attaches the
order id — external calls never sit inside the seat-reservation
transaction (§5.5), and if `createOrder()` were to fail, the booking
still exists as `PENDING_PAYMENT` and self-heals via the same TTL expiry
path as an abandoned payment.

Cancellation (`bookingRepository.cancel`, passenger-initiated, valid
from `PENDING_PAYMENT` or `CONFIRMED`) and expiry
(`bookingRepository.expireIfPending`, TTL-job-initiated, valid only from
`PENDING_PAYMENT`) are two distinct conditional updates rather than one
shared function — a `CONFIRMED` booking must never be touched by the
expiry job, only by an explicit passenger cancel. Both release seats via
`rideRepository.releaseSeats` inside the same transaction as the
booking-status conditional update, so a booking that's already
terminal by the time either runs is a no-op (idempotent, satisfies
"must not release seats for a booking that was confirmed in the
meantime").

Verified end-to-end against the real Postgres/Redis/BullMQ stack (no
automated test infra yet, per the Phase 3 note; `BOOKING_PAYMENT_TTL_SECONDS`
temporarily set to 5s for fast expiry testing). **The mandatory
concurrency test**: two passengers firing simultaneous `POST
/bookings` requests at a ride with exactly 1 seat left (real parallel
threads, not sequential) — exactly one received 201, the other 409
`NO_SEATS_AVAILABLE`; the ride's `available_seats` ended at exactly 0
(never negative) and `status` correctly flipped to `FULL`; exactly one
booking row existed afterward. Also verified: a driver booking their own
ride → 409 `CANNOT_BOOK_OWN_RIDE`; a nonexistent ride → 404
`RIDE_NOT_FOUND`; requesting more seats than the ride has → 409
`NO_SEATS_AVAILABLE`; booking a still-`PENDING_PAYMENT` (not yet `OPEN`)
ride → 409 `RIDE_NOT_BOOKABLE`; a booking with a custom pickup
coordinate correctly stored it while drop correctly defaulted to the
ride's own destination; fare/prepayment math matched hand calculation
exactly (₹188 fare × 1 seat × 10% → ₹19); `GET /bookings/:id` correctly
visible to both the owning passenger and the ride's driver, and 404 (not
403) for an unrelated passenger — existence not leaked; an unrelated
passenger's cancel attempt → 404; a fresh booking's immediate manual
cancel correctly released the seat and restored ride status to `OPEN`;
cancelling an already-`CANCELLED` booking → 409
`BOOKING_ALREADY_CANCELLED`; and — cleanly isolated from the manual-cancel
test — a booking left completely untouched past the 5s TTL was
automatically transitioned to `CANCELLED` by the BullMQ worker and its
seats released, flipping the ride from `FULL` back to `OPEN` with the
correct count, with no manual intervention. `npm run typecheck`, `npm
run lint`, and `npm run build` all pass.

Not built in this phase, intentionally deferred: actual payment
confirmation (`PENDING_PAYMENT -> CONFIRMED`, `PAYMENT_FAILED`
transitions) — both are Phase 10's webhook; forfeiture of the prepaid
amount and any refund logic on cancellation — Phase 11 (§34).

------------------------------------------------------------------------

## 11. Payments (Phase 10)

Razorpay behind the existing `PaymentProvider` interface, idempotency keys, and
webhook processing.

The rule that shapes everything here is that the client's success callback is
never authoritative — a signature-verified webhook drives every state change.
Since webhooks get retried, every transition fires from exactly one source state,
so duplicate delivery matches nothing and is a no-op.

Idempotency is enforced by the database rather than by application checks: a
UNIQUE constraint on `(user_id, key)` decides which of two concurrent requests
with the same key wins, and the loser replays the stored response. The interface
also gained a fourth method, `verifyWebhookSignature` — signature verification is
vendor-specific crypto, which is exactly the kind of detail the abstraction exists
to keep out of the domain.

## Status: complete

Implemented `RazorpayProvider` (`src/infrastructure/payments/razorpayProvider.ts`,
real `razorpay` SDK + real HMAC-SHA256 signature verification), `Payment`/
`Transaction`/`IdempotencyKey` Prisma models (migration
`20260812144013_payment_system`), the full payment module
(`src/modules/payment/`: repositories, `paymentRecordService`,
`webhookService`, `POST /api/v1/webhooks/payment`), and
`Idempotency-Key` middleware (`src/app/middleware/idempotency.ts`) wired
onto `POST /rides` and `POST /rides/:id/bookings` — the two
payment-producing endpoints from Phases 7/9.

`PaymentProvider` gained a fourth method, `verifyWebhookSignature`, since
webhook signing is vendor-specific raw crypto that belongs behind the
interface, not hardcoded in the webhook module (spec §37/§40).
`StubPaymentProvider` implements it for real (HMAC against
`PAYMENT_PROVIDER_WEBHOOK_SECRET`) so local testing without a Razorpay
account still exercises genuine signature verification. The factory
(`infrastructure/payments/index.ts`) now branches Stub vs. Razorpay on
configured `PAYMENT_PROVIDER_KEY`/`SECRET`, exactly mirroring Resend's
real-vs-console-fallback pattern.

Webhook processing (`webhookService.processPaymentWebhook`) runs the
full spec §40 flow in one DB transaction: verify signature →
identify the `Payment` row by `provider_order_id` → idempotency check
(conditional `CREATED -> SUCCESS/FAILED`, so a duplicate delivery is a
no-op) → resolve the matching `Transaction` → apply the ride/booking
state transition (`PENDING_PAYMENT -> OPEN`/`CANCELLED` for the driver's
posting fee, `PENDING_PAYMENT -> CONFIRMED`/`PAYMENT_FAILED` for a
booking's prepayment, releasing seats on failure). Notification
enqueueing (the last step in spec §40's flow) is explicitly not
built — Phase 12 doesn't exist yet.

Payment and Transaction rows are created together by one function
(`paymentRecordService.recordOrder`), called from inside the same DB
transaction as the ride/booking INSERT for ride creation, and from a
small follow-up transaction (after the external `createOrder()` call,
per §5.5) for booking creation — see the decision log (§18) (2026-08-13) for why
both records are created together rather than Transaction-only-on-success.

One real bug found and fixed during testing, documented in the decision log (§18)
(2026-08-13): a payment webhook arriving *after* a booking's seat-hold
TTL already expired left the Payment/Transaction correctly `SUCCESS` but
the booking silently stuck `CANCELLED` with no signal anything was
wrong. Fixed by checking the conditional state-transition's return value
and logging an explicit error for manual review — a full fix (automatic
refund) needs Phase 11's refund policy, which doesn't exist yet, so it's
deferred rather than invented.

Verified end-to-end against the real stack (no automated test infra
yet, per the Phase 3 note; `.env` has real Razorpay **test-mode**
credentials, confirmed via genuine `order_...` ids returned from
Razorpay's actual API — not the stub):

-   **Idempotency**: missing `Idempotency-Key` → 400
    `IDEMPOTENCY_KEY_REQUIRED` on both endpoints; a replayed
    identical request returned the exact cached response (same ride/
    booking id, byte-identical JSON) without creating a second resource
    or a second Razorpay order; the same key with a different body → 409
    `IDEMPOTENCY_CONFLICT`.
-   **Webhooks**: a real signed `payment.captured` for a ride's posting
    fee correctly flipped `PENDING_PAYMENT -> OPEN` and resolved
    Payment/Transaction to `SUCCESS`; the identical webhook re-delivered
    → 200, idempotent no-op (verified no re-processing); a wrong
    signature → 401 `INVALID_WEBHOOK_SIGNATURE`; an unrecognized event
    type (e.g. `order.paid`) → 200, no-op; a webhook for an unknown
    `order_id` → 404 `PAYMENT_NOT_FOUND` (deliberately retry-worthy, not
    200 — see the decision log (§18) for why); `payment.failed` for a ride's
    posting fee → `PENDING_PAYMENT -> CANCELLED`; `payment.failed` for a
    booking holding the ride's last 2 seats → booking ->
    `PAYMENT_FAILED` and the ride's seats correctly released
    (`0/FULL -> 2/OPEN`); a `payment.captured` for a booking sent
    immediately (well before its TTL) → `CONFIRMED`, and confirmed
    still `CONFIRMED` 10 seconds past the TTL window — proving
    `cancelScheduledBookingExpiry` actually removed the pending BullMQ
    job rather than relying solely on the (already idempotent) no-op
    path.

`npm run typecheck`, `npm run lint`, and `npm run build` all pass.

Not built in this phase, intentionally deferred to Phase 11
(Cancellation, Refunds, Settlement): `RazorpayProvider.refund()` (still
throws), the driver-cancellation refund-percentage policy (§31), final
90% payment collection and 97/3 driver/platform settlement split (§41),
and automatic refund handling for the late-payment-after-expiry edge
case found above.

------------------------------------------------------------------------

## 12. Cancellation, refunds and settlement (Phase 11)

Driver cancellation cascading into every booking on the ride, the time-based
commission refund policy, and collection of the final 90%.

The cascade is one transaction: cancel the ride, then cancel each active booking
while branching on *its own* return value rather than the snapshot read a moment
earlier — a passenger may be self-cancelling concurrently. Refund intents are
recorded as `PENDING` transactions inside that transaction; the actual gateway
call happens afterwards as a retryable job, because external calls never belong
inside a transaction.

Two gaps were closed here. One had been flagged and deferred in Phase 10: a
payment captured *after* its booking already expired now creates a refund rather
than only logging a warning. The other was found in this phase and had not been
flagged at all — nothing stopped a passenger cancelling a confirmed booking after
the ride had started, which would dodge the final payment entirely.

## Status: complete

Implemented all three money/state-transition flows in `src/modules/ride/`,
`src/modules/booking/`, and `src/modules/payment/`.

**Driver cancellation cascade** (`rideService.cancelRide`, rewritten):
computes the refund policy (`cancellationPolicyService.
calculateDriverCancellationRefund`, new — the sole place §31's formula is
computed: `refundAmount = round(postingCommissionAmount *
(DRIVER_EARLY_CANCEL_REFUND_PERCENT / DRIVER_COMMISSION_PERCENT))`, i.e.
2/5 of the captured commission when `departureTime - now >=
DRIVER_CANCEL_THRESHOLD_HOURS`, else 0; `retainedAmount` is the complement
so the two always sum to exactly the commission, satisfying §84 "refund
cannot exceed refundable amount" by construction) *before* opening a
transaction, then in one `prisma.$transaction`: conditionally cancels the
ride (`rideRepository.cancel`, now `(db, id)` — its only call site, always
inside this cascade), finds every still-active booking on it
(`bookingRepository.findActiveByRideId`, new: `PENDING_PAYMENT`|
`CONFIRMED`), and for each one gates strictly on `bookingRepository.
cancel(tx, id)`'s own return value (not the find's snapshot) before
releasing its seat or creating a refund — so a booking a passenger
self-cancelled microseconds earlier in a separate committed tx is skipped
entirely, never double-refunded. A booking that *was* `CONFIRMED` gets a
`PENDING` `REFUND` transaction for its full prepaid amount (§34: driver
cancellation is the one case the 10% *is* refunded); one that was still
`PENDING_PAYMENT` gets no refund (nothing was captured) but its scheduled
BullMQ expiry job is now pointless and is removed after commit. If the
driver's own commission was actually captured (`paymentRepository.
findSuccessfulByRideId`) and the policy says `refundAmount > 0`, one more
`PENDING` `REFUND` transaction is created for the driver. Per §59 ("do not
call external payment APIs inside the transaction"), the actual
`PaymentProvider.refund()` calls are deferred to a new BullMQ `refund`
queue/worker (`src/infrastructure/queue/queues.ts`+`refundWorker.ts`,
mirroring `booking-expiry` exactly), scheduled after the cascade commits.

**Refund processing** (`src/modules/payment/services/refundService.ts`,
new): `processRefund` loads the `REFUND` transaction and short-circuits if
it's not `PENDING` *before* ever calling the provider — closes a
crash-then-retry window where the process could die after
`PaymentProvider.refund()` succeeds at the gateway but before the DB
commit, which would otherwise cause a BullMQ retry to refund the same
payment twice. Dispatches on whether `bookingId`/`rideId` is set to find
the original captured `Payment` (`paymentRepository.
findSuccessfulByBookingId`/`findSuccessfulByRideId`, new) for its
`providerPaymentId`, calls `PaymentProvider.refund()`, then resolves the
transaction `PENDING -> SUCCESS` (`transactionRepository.resolveById`,
new — same conditional-update idempotency pattern as everywhere else in
this codebase) with the real/stub refund id. `RazorpayProvider.refund()`
and `StubPaymentProvider.refund()` (both previously threw, per Phase 10's
notes) are now implemented for real — Razorpay via `client.payments.
refund(paymentId, { amount })`, Stub via a locally-generated reference id,
same real-vs-fallback split as every other provider in this codebase.

**Passenger cancellation**: already correct by omission (no refund code
existed anywhere, so the 10% was already effectively "retained," §34) —
this phase adds one guard: `bookingService.cancelBooking` now checks
(inside its existing transaction, to avoid a TOCTOU gap against a
concurrently-starting ride) whether the ride has reached `STARTED`/
`COMPLETED` via a new `rideRepository.findStatusById`, and rejects with a
new `409 BOOKING_NOT_CANCELLABLE` if so. Without this, a passenger could
self-cancel a `CONFIRMED` booking after the ride starts and dodge the
final-payment collection this same phase adds — closing that gap was
judged in-scope here rather than deferred, since it's a direct financial-
invariant hole created by this phase's own final-payment work.

**Final payment + settlement**: `rideService.completeRide` now calls
`finalPaymentService.createFinalPaymentOrdersForRide(rideId)` (new,
`src/modules/booking/services/`) after `rideRepository.complete()`
succeeds — synchronous with the same request, mirroring how ride/booking
creation already auto-create their payment orders as part of the same
request rather than requiring a separate passenger-initiated endpoint.
For every `CONFIRMED` booking on the ride, computes the remaining amount
(`settlementService.calculateRemainingFare`, new: `round(totalFare -
prepaidAmount)`, using the fare *locked* on the booking, never
recalculated) and creates a `FINAL_PAYMENT` order via the existing
external-call-then-follow-up-tx pattern (`booking.finalPaymentOrderId`,
new nullable column, migration `20260812171513_settlement_and_refunds`).
Guards against re-creating an order if one already exists (idempotent
against a manual re-invocation after a partial failure, since
`completeRide` itself can't be retried once the ride is `COMPLETED`) and
wraps each booking in try/catch (`Promise.allSettled`) so one failure
doesn't block others or block ride completion. `webhookService` gained a
`FINAL_PAYMENT` branch: on success, `bookingRepository.completeBooking`
(new, conditional `CONFIRMED -> COMPLETED`) and then
`settlementService.calculateSettlement` (new: `platformCommission =
round(totalFare * PLATFORM_COMMISSION_PERCENT/100)`, `driverShare =
totalFare - platformCommission` — the one place §84's "application
commission is calculated exactly once" is computed) is logged in a
structured, greppable line; there is no wallet/payout table in scope
(§6) and `TransactionType` is a closed enum, so the split isn't persisted
as a new row — it's ready for a future payout module to consume. On
failure, logged for manual follow-up (no seat to release, ride already
happened).

**Closed a gap Phase 10 explicitly flagged and deferred to this phase**:
a payment webhook resolving `SUCCESS` *after* the ride/booking it belongs
to already left `PENDING_PAYMENT` via the cancellation cascade (a genuine
race — driver cancels at the same moment a delayed webhook resolves) used
to just `console.error` "needs manual refund review." Both `applied ===
false` branches in `webhookService` (`DRIVER_RIDE_FEE` and
`BOOKING_PREPAYMENT`) now instead create a `PENDING` `REFUND` transaction
in the same tx (reusing the exact same driver-cancellation-policy
calculation for the commission case) and schedule it after commit — the
same machinery the cascade itself uses, so whichever of the two
transactions (cascade vs. webhook) commits second is the one that
actually creates the refund; verified neither double-refunds nor leaves a
captured payment with no refund path.

**Real bug found and fixed before any of the above**: the migration this
phase generated (`prisma migrate dev` diffing the new
`finalPaymentOrderId` column) also silently emitted `DROP INDEX
"rides_origin_gist"`/`"rides_destination_gist"` — because `Ride.origin`/
`destination` are `Unsupported(...)` columns (§16/§77), Prisma's schema-
diff engine has no record that those hand-written GiST indexes
(`20260812123854_ride_creation`) are supposed to exist, and reconciled
them away as "unknown" the moment any other Ride-adjacent migration ran.
Confirmed via `\di rides_*gist` that both indexes were actually gone from
the dev DB. Fixed by editing the migration file to drop the `DROP INDEX`
statements and re-add the original `CREATE INDEX ... USING GIST` ones
verbatim, and re-running them directly against the already-migrated dev
DB. `EXPLAIN ANALYZE` re-confirmed `BitmapAnd` over both GiST indexes plus
the `departure_time`/`status` btree index, matching Phase 8's original
verification. This is a standing risk for any *future* migration too —
worth remembering that any schema change touching `rides` needs its
generated SQL diffed against expectations before applying, not just
trusted, as long as `origin`/`destination` stay `Unsupported`.

Verified end-to-end against the real Postgres/Redis/BullMQ stack (no
automated test infra yet, per the Phase 3 note; `PAYMENT_PROVIDER_KEY`/
`SECRET` and `RESEND_API_KEY` temporarily blanked so `StubPaymentProvider`
handled `refund()` deterministically without needing a real
browser-driven Razorpay checkout to produce a genuine captured payment to
refund against, and OTPs logged to console — both restored afterward)
with a scripted end-to-end run covering: early (>=18h) driver cancellation
— 2/5 driver refund + full passenger refund, both resolved `SUCCESS` by
the worker with a real stub refund id; late (<18h) driver cancellation —
passenger refund only, no driver refund transaction at all; cascade over
a still-unpaid (`PENDING_PAYMENT`) booking — cancelled, seat released, no
refund transaction (nothing was ever captured); the mandatory concurrency
test — two passengers racing for a ride's last seat, exactly one `201`
and one `409`, seats never negative; full final-payment lifecycle —
`FINAL_PAYMENT` order/Payment/Transaction created for exactly the locked
remaining 90%, webhook confirmation flips booking to `COMPLETED`, and the
settlement log line appears with the correct 97/3 split; passenger
self-cancel blocked with `409 BOOKING_NOT_CANCELLABLE` once the ride has
`STARTED`, while the identical cancel *before* start still succeeds and
correctly creates no refund transaction (10% retained); and both webhook-
race scenarios from Phase 10's flagged gap — a driver posting-fee payment
and a booking prepayment each resolving `SUCCESS` after their ride/
booking was already cancelled — correctly created and resolved a refund
transaction rather than silently leaving captured money with no refund
path. `npm run typecheck`, `npm run lint`, and `npm run build` all pass.

Not built in this phase, intentionally out of scope: any real driver
payout/settlement disbursement (§6 — no wallet/payout system exists;
`calculateSettlement`'s result is logged, not paid out anywhere), refund-
webhook handling for Razorpay's own async `refund.processed` event (this
phase's refunds are resolved synchronously from `PaymentProvider.
refund()`'s own response, not a webhook), and notification enqueueing for
any of the new events (`RefundProcessed`, etc. — Phase 12).

------------------------------------------------------------------------

## 13. Notifications (Phase 12)

Push delivery through FCM behind a `PushProvider` interface, plus a persisted
in-app notification history.

Persistence and delivery are separate steps on purpose. The notification row is
upserted first, keyed by an id generated at *enqueue* time so retries are
idempotent — an id generated in the worker would differ on every attempt and
create duplicates. Delivery is then attempted and allowed to throw, so BullMQ's
bounded backoff applies. A push failure can never prevent the in-app record from
existing.

## Status: complete

Implemented the full notification module (`src/modules/notification/`),
an FCM `PushProvider` abstraction (`src/infrastructure/fcm/`), and a new
`notification` BullMQ queue/worker — new migration
`20260812182449_notifications` (`UserDevice`, `Notification`,
`DevicePlatform`, `NotificationType`).

`PushProvider` (spec §17/§37-style strategy interface): `send(tokens,
payload): Promise<PushSendResult[]>`, resolving per-token success/
invalid-token outcomes rather than throwing per token (real FCM behavior —
stale tokens are routine), only throwing for a genuine gateway-level
failure. `FirebasePushProvider` uses the real `firebase-admin` SDK
(`sendEachForMulticast`, deliberately using the deprecated `tokens` field
over the newer FID-based API since our domain model is registration
tokens, matching spec §45's `user_devices.device_token`).
`ConsolePushProvider` is the local-dev fallback (logs instead of sending,
always reports success), selected the same way Resend/Razorpay's
factories already do (`infrastructure/fcm/index.ts`).

**Real bug found and fixed during manual verification**: unlike Resend/
Razorpay's constructors (which just store the key and fail lazily on
first real call), firebase-admin's `cert()` synchronously parses the
private key and throws immediately on anything that isn't valid PEM —
confirmed by actually crashing the entire process at import time with
this environment's `.env` `FCM_PRIVATE_KEY` (not a real PEM key). A
misconfigured push credential must degrade push delivery, not take down
auth/rides/payments/everything else, so `createPushProvider()` now wraps
`FirebasePushProvider` construction in try/catch and falls back to
`ConsolePushProvider` on failure, logging the error — same graceful-
degradation contract as the "not configured" case. Re-verified after the
fix: server boots cleanly and serves traffic normally with the invalid
key still in `.env`.

**Notification delivery pipeline** (`notificationService.ts`): every
`notify*` function (one per `NotificationType`, each owning its own
title/body copy rather than a shared template registry with a single
call site apiece, spec §86) enqueues a `deliver-notification` BullMQ
job with a deterministic `id` generated at enqueue time. The worker
(`processNotificationJob`) does two independent steps, per spec §46
("FCM delivery and notification persistence are separate concerns"): (1)
`notificationRepository.upsert` — idempotent by that same `id`, so a
BullMQ retry's persistence step is a no-op rather than a duplicate row;
(2) fetch the user's device tokens and call `pushProvider.send()`,
left to throw on a genuine gateway failure so BullMQ's retry/backoff
(`attempts: 5`, exponential) retries the *whole* job — safe because step
(1) is already idempotent. Tokens FCM reports invalid are removed
(`userDeviceRepository.removeTokens`, spec §45 — deletion, since
`user_devices` has no status field in the given schema).

**Event wiring** — one `notify*` call added at each transition, into
existing Phase 7-11 code:
- `bookingService.createBooking` → `RIDE_BOOKED` (driver)
- webhook `BOOKING_PREPAYMENT`/`FINAL_PAYMENT` success → `BOOKING_CONFIRMED` /
  implicit via `RIDE_COMPLETED` already covering the ride side
- `bookingService.cancelBooking` (self-cancel) and
  `bookingExpiryService.processBookingExpiry` (TTL expiry) → `BOOKING_CANCELLED`
- `rideService.cancelRide` cascade → `RIDE_CANCELLED` per affected passenger
- `rideService.startRide` / `completeRide` → `RIDE_STARTING` / `RIDE_COMPLETED`
  per `CONFIRMED` booking's passenger (reusing Phase 11's
  `bookingRepository.findConfirmedByRideId`)
- `webhookService` (every resolved payment, all three transaction types) →
  `PAYMENT_SUCCESS`/`PAYMENT_FAILED` for the paying user — `paymentRecordService.
  resolvePaymentByOrderId`'s `ResolvePaymentResult` gained `userId`/`amount`
  fields (already in scope from the `payment` row it reads) so the webhook
  doesn't need an extra lookup
- `refundService.processRefund` (after a refund actually resolves to
  `SUCCESS`) → `REFUND_PROCESSED`

New endpoints: `POST /api/v1/users/me/devices` (register/upsert a device
token — routed on `userRouter`, delegating to the notification module's
`deviceController`, same cross-module routing pattern as booking-on-ride),
`GET /api/v1/notifications` (cursor-paginated, newest-first — a simpler
single-fixed-order cursor than ride search's, `notificationCursor.ts`),
`PATCH /api/v1/notifications/:id/read` (idempotent — re-marking an
already-read notification returns the existing `readAt` rather than
erroring; scoped to the caller's own notifications, 404 on anyone else's
or nonexistent).

**Second, unrelated bug found before any of the above (fixed first,
blocking)**: the very first `prisma migrate dev` run for this phase's
schema change failed the shadow-database replay with `relation
"rides_origin_gist" already exists` — root cause was Phase 11's own fix to
this exact problem (`20260812171513_settlement_and_refunds`, the decision log,
2026-08-14) had re-added a plain `CREATE INDEX` for the two hand-
written `rides` GiST indexes, which collides on a *fresh* database replay
since the original migration (`20260812123854_ride_creation`) already
creates them earlier in the same replay — Phase 11's fix only worked
against the one already-migrated dev DB it was written against, not
against a from-scratch environment. Fixed by making that CREATE INDEX
`IF NOT EXISTS`. Then, once migrate dev proceeded, Prisma's diff
generated the *same class* of erroneous `DROP INDEX` for both indexes
*again* in this phase's own new migration — confirming this isn't a
one-off, it's structural for as long as `rides.origin`/`destination` stay
`Unsupported` (invisible to Prisma's schema diff). Stripped from this
migration's SQL the same way. Both fixes applied without a destructive
`prisma migrate reset` — the already-applied migrations' stored
checksums were updated directly (`UPDATE _prisma_migrations SET
checksum = ...`, computed via `shasum -a 256` of the corrected file) to
match the corrected SQL, preserving all existing dev data. Added a
standing process rule (§21 (Migration procedure)) so this doesn't need rediscovering
in Phase 13+: always `prisma migrate dev --create-only`, inspect for
these two `DROP INDEX` statements, strip them before applying.

Verified end-to-end against the real Postgres/Redis/BullMQ stack (no
automated test infra yet, per the Phase 3 note) with two passes:
`RESEND_API_KEY`/`PAYMENT_PROVIDER_KEY`/`FCM_*` all blanked (deterministic
console-fallback run — 24 scripted assertions, all passing): device
registration and re-registration upserting the same token rather than
duplicating; all nine notification types fired with correct recipient
and content (`RIDE_BOOKED` to the driver on booking creation;
`BOOKING_CONFIRMED`+`PAYMENT_SUCCESS` on prepayment webhook;
`RIDE_STARTING`/`RIDE_COMPLETED` to the confirmed passenger;
`PAYMENT_SUCCESS` again for the locked final-90%-payment amount;
`PAYMENT_FAILED` on a failed webhook; `BOOKING_CANCELLED` on passenger
self-cancel; `RIDE_CANCELLED`+`REFUND_PROCESSED` on a driver cascade
cancellation with a confirmed booking); `GET /notifications` returning
the expected items; mark-read setting `readAt`, idempotent on a second
call (same `readAt`, not an error), and 404 for a nonexistent/foreign
notification id. Second pass with real (but invalid) `FCM_*` credentials
restored — confirmed the graceful-fallback fix above, then re-ran the
identical 24-assertion suite against that server instance to confirm the
full pipeline is unaffected by which push-provider branch is active.
`npm run typecheck`, `npm run lint`, and `npm run build` all pass.

Flagged to the user, not a code defect: this environment's `.env`
`FCM_PRIVATE_KEY` is not a valid PEM key (confirmed by the crash this
phase's graceful-fallback fix now catches) — real push delivery needs a
genuine Firebase service-account key before it'll actually send anything;
until then `ConsolePushProvider` handles it transparently.

Not built in this phase, intentionally out of scope: the `PaymentSuccessful`/
`PaymentFailed`/`RefundProcessed` naming in steps.md's own event list above
was reconciled against spec §44's authoritative `NotificationType`
enum (`PAYMENT_SUCCESS`/`PAYMENT_FAILED`/`REFUND_PROCESSED`, plus
`RIDE_BOOKED` which steps.md's list omits but spec §44 includes) —
the design spec is authoritative here, so its 9-value
enum was implemented as-is. No notification-preferences/opt-out system
(not specified), no digest/batching (each event is its own immediate
notification, matching "do not block... waiting for FCM" §42's
real-time framing).

------------------------------------------------------------------------

## 14. Driver–passenger chat (Phase 13)

Socket.IO messaging scoped to a ride, with a Redis adapter so the design survives
multiple instances before it ever runs on them.

One conversation exists per `(ride, passenger)` pair rather than one room per
ride, enforced by a unique constraint, so the driver talks to each passenger
separately. Participation is re-checked on every `send_message`, not only on
`join_conversation` — a client can emit a send without ever having joined.

## Status: complete

Implemented `Conversation`/`Message` Prisma models (migration
`20260813053512_chat_conversations_messages`) and the full chat module
(`src/modules/chat/`), plus a Socket.IO gateway
(`src/infrastructure/socket/socketServer.ts`,
`src/modules/chat/socket/chatGateway.ts`) wired into `server.ts`, which now
creates an explicit `http.Server` (so both HTTP and WebSocket traffic share
one port) instead of relying on `app.listen()`'s internal one.

**One conversation per (ride, passenger) pair**, not one shared room per
ride — spec §47's conceptual schema (`ride_id`, `driver_id`,
`passenger_id` on one `conversations` row) already implies this: the driver
talks to each passenger separately. Enforced by a `@@unique([rideId,
passengerId])` constraint. `driverId` is denormalized from `ride.driverId`
at creation time (a ride's driver never changes post-creation, so this
never goes stale) so authorization checks never need to join through `Ride`.

**Conversations are created lazily**, not via a dedicated REST endpoint —
`bookingService.createBooking` calls
`conversationService.getOrCreateConversationForRide` right after a booking
is created (mirroring where `notifyRideBooked` already fires), the first
time a given passenger has a reason to talk to the ride's driver. Idempotent
via the unique constraint, so a second booking by the same passenger on the
same ride reuses the existing conversation. Not gated on booking/payment
status — either party may reasonably want to talk before payment confirms.

**REST endpoints beyond what spec §47/§51 explicitly lists** — `GET
/api/v1/conversations` (list the caller's conversations, newest-first,
cursor-paginated, each with a `counterpart` {id, name} and `lastMessage`
preview) and `GET /api/v1/conversations/:id/messages` (cursor-paginated
history). §47 only specifies the WebSocket flow and entities, not a REST
surface, but a chat client has no way to discover conversation IDs or load
history without one — engineering necessity, not a business-policy
invention (spec §90/§26: same cursor-pagination shape as
notifications/ride-search, `{items, nextCursor}`, opaque base64url cursor).
Message *sending* stays WebSocket-only, matching §47's diagram exactly — no
REST POST-message endpoint exists.

**WebSocket flow implemented exactly as specified**: `io.use()` middleware
authenticates via the same `verifyAccessToken()` HTTP's `authenticate`
middleware uses (token read from `socket.handshake.auth.token`, falling
back to an `Authorization: Bearer` header), storing `{id, role}` on
`socket.data`. `join_conversation` and `send_message` both independently
call `conversationService.authorizeParticipant` — join does not grant
send any special trust, since "do not trust conversation IDs from the
client" (§47) means a client could emit `send_message` without ever
joining. A non-participant gets `CONVERSATION_NOT_FOUND` from both events
(404-equivalent — existence isn't leaked, same pattern as
`bookingService.getBooking`/vehicle ownership checks elsewhere in this
codebase) rather than a distinguishable "forbidden." Messages are persisted
then emitted only to the `conversation:{id}` room (Socket.IO room, joined
only by authorized sockets) — never broadcast wider.

**Multi-instance readiness** (§67): `createSocketServer` attaches
`@socket.io/redis-adapter` using two `redis.duplicate()` connections
(pub/sub mode needs dedicated connections, can't share the general-purpose
`infrastructure/redis` client that also serves OTP/rate-limiting). Not
independently load-tested against a second running instance in this phase
(no second instance was stood up) — the adapter wiring itself was verified
correct (server boots cleanly, no adapter connection errors in logs) and is
the same pattern the spec documents (§67) and BullMQ already uses
elsewhere in this codebase (`infrastructure/queue/connection.ts`) for the
same "needs its own Redis connection" reason.

No migration drift beyond the third recurrence of the standing `rides`
GiST-index issue (§21 (Migration procedure)) — stripped the same two spurious `DROP
INDEX` statements from this migration's generated SQL before applying, per
the existing process rule. No other schema drift.

Verified end-to-end against the real Postgres/Redis stack (no automated
test infra yet, per the Phase 3 note; `RESEND_API_KEY` temporarily blanked
for console-logged OTPs, restored afterward) using an existing
driver/passenger/ride from earlier phase testing: booking a ride correctly
auto-created exactly one `conversations` row (confirmed directly in
Postgres); `GET /conversations` returned the correct `counterpart` from
each side (driver sees the passenger's name and vice versa); `GET
/conversations/:id/messages` correctly scoped — a third user (the seeded
admin, a genuine non-participant) got 404 `CONVERSATION_NOT_FOUND` from
both a real conversation id and a random UUID, indistinguishably. Over a
real WebSocket connection (`socket.io-client`): connecting without a token
or with a garbage token was rejected at the `connect_error` stage before
ever reaching `connection`; the non-participant admin's `join_conversation`
and `send_message` both got `CONVERSATION_NOT_FOUND` acks and never
received the `message` broadcast; the driver and passenger both joined
successfully; a message sent by the driver was persisted (visible
immediately via the REST message-history endpoint), broadcast to the
passenger (received the `message` event), and correctly *not* broadcast to
the admin socket (never joined the room); an empty message and a
non-UUID `conversationId` both correctly got `VALIDATION_ERROR` acks
without persisting anything. Cursor pagination over 4 messages at
`limit=2` walked two full pages with no duplicates/gaps, then correctly
returned an empty final page with `nextCursor: null`; a malformed cursor on
the REST endpoint → 400 `INVALID_CURSOR`. `npm run typecheck`, `npm run
lint`, and `npm run build` all pass.

Not built in this phase, intentionally out of scope: read receipts beyond
the `readAt` column already existing on `Message` (no endpoint sets it —
spec §47 doesn't specify a mark-read flow for chat, unlike
notifications' explicit `PATCH .../read`, so none was invented); typing
indicators/presence (not specified); push notifications for new chat
messages (spec §44's `NotificationType` enum has no chat-message
value — out of scope per the same "don't invent business requirements"
reasoning as Phase 12's notes).

------------------------------------------------------------------------

## 15. AI support chatbot (Phase 13.5)

A support assistant that answers questions about how SaathiRide works and looks up the
caller's own bookings and rides, behind an `AIProvider` interface.

The interesting part is the authorization boundary. The tool schemas exposed to
the model contain **no identity parameter at all** — only resource ids. The
executor binds the user id from the authenticated session and calls the same
ownership-checked service methods the REST API uses. Whether a user may see a
resource is therefore never a question the model is asked or able to answer.

That boundary was tested directly: asked to fetch another user's booking with a
prompt asserting "it is my booking", the tool layer refused and the assistant
reported not-found, leaking nothing.

## Status: complete

Implemented `SupportConversation`/`SupportMessage` Prisma models (migration
`20260813070602_support_chatbot`), `src/infrastructure/ai/` (the
`AIProvider` interface plus `GeminiProvider` and `ConsoleAIProvider`,
selected by the same configured-vs-fallback factory every other provider
in this codebase uses), and the full `src/modules/support/` module wired
at `/api/v1/support`.

**Provider is Gemini, not Grok** — corrected before implementation (see
the decision log, 2026-08-16) since a Gemini API key is what was actually
available. `ChatbotService` imports only the interface-typed singleton, so
this was a pure infrastructure choice; nothing in the module changed.

**The tool layer works as specified**: tool JSON-schemas exposed to the
model contain no `userId`/identity parameter, and `executeToolCall` binds
`userId` from the authenticated request context, dispatching only to
existing ownership-checked service methods
(`bookingService.getBooking`/`getMyRecentBookings`,
`rideService.getRide`/`getMyRecentRidesAsDriver` — the two `getMy*`
methods are new read-only additions). A tool failure becomes a tool-result
message fed back to the model rather than aborting the turn, so the
assistant can say it couldn't find something instead of the request 500ing.

### Four real bugs found and fixed during verification

1.  **`gemini-2.0-flash` is no longer served** — the API returns 404
    "no longer available" for it. Default is now the
    `gemini-flash-lite-latest` **alias**, so a future model retirement
    doesn't break this again; `GEMINI_MODEL` stays configurable for
    pinning. The *lite* alias specifically, for a reason found the hard
    way during verification: free-tier quota is
    `GenerateRequestsPerDayPerProjectPerModel`, i.e. **per model, per
    day**, and the flagship alias (`gemini-flash-latest` →
    `gemini-3.6-flash`) carries only ~20 requests/day — exhausted almost
    immediately by ordinary testing. The lite alias has its own separate,
    far more generous budget, and a support bot answering FAQs and doing
    simple tool lookups does not need flagship reasoning. Note also that
    `gemini-2.5-*` models return "no longer available **to new users**"
    on a fresh key, so they are not a fallback.
2.  **Gemini rejects a non-object `functionResponse.response`** ("Proto
    field is not repeating, cannot start list") — our tool results are
    frequently JSON arrays (`getMyRecentBookings` returns `[]`). Anything
    that isn't already a plain object is now wrapped as `{ result: ... }`.
3.  **Newer Gemini models require a `thought_signature` to be echoed
    back** on any `functionCall` part replayed in a later turn, or the
    request is rejected outright — which broke *every* multi-turn
    conversation that had made a tool call. Fixed by adding an opaque
    `providerState` field to `AIToolCall` in the provider-agnostic
    interface (deliberately not named `thoughtSignature`, so the vendor
    concept doesn't leak into the abstraction); it is persisted inside
    the `tool_calls` JSON and replayed verbatim. Verified it round-trips
    through Postgres, so this survives a server restart mid-conversation.
    Also note `response.functionCalls` (the SDK's flattened getter)
    silently drops it — the provider reads the raw candidate parts instead.
4.  **`AI_PROVIDER_RATE_LIMITED` was specified but never mapped.** A
    provider quota rejection was collapsing into a generic
    `AI_PROVIDER_ERROR`. Now detected (upstream 429) and surfaced as its
    own code with a 503. The vendor's 429 is deliberately not forwarded
    as a 429 to our client — SaathiRide's own per-user limits are what govern
    the caller.

### Verified end-to-end against the real stack

Real Postgres/Redis and the **real Gemini API** (no automated test infra,
per the standing project note; `RESEND_API_KEY` temporarily blanked for
console-logged OTPs, restored afterward). Confirmed: a policy question is
answered from the configured business-rule constants (correct 5%/18h/2pp
figures, proving the system prompt is built from config and not the
model's own guesses); multi-turn follow-ups retain context; tool-calling
returns real data; **a request for another user's booking id — with the
prompt explicitly claiming "it is my booking" — is refused by the tool
layer and reported as not-found, with no data leaked**; a request for a
driver's phone number and home address produced no invented data;
conversation ownership is enforced on both read and post with an
indistinguishable `SUPPORT_CONVERSATION_NOT_FOUND` (a second user sees
neither the conversation nor its existence); unauthenticated access 401s;
empty/overlong messages and malformed cursors are rejected by validation;
cursor pagination walks pages correctly. Rate limiting was exercised with
a 13-request burst against a limit of 10/60s — exactly 3 got `429`.
All four tools were individually exercised against real data
(`getMyRecentBookings`, `getBookingStatus`, `getMyRecentRidesAsDriver`,
`getRideStatus` — the last correctly reporting a real ride as
`CANCELLED`). Both provider failure mappings were confirmed against
genuine upstream conditions, not simulated: `AI_PROVIDER_TIMEOUT` from a
real abort, `AI_PROVIDER_RATE_LIMITED` from a real quota rejection. The
`ConsoleAIProvider` no-key path was exercised separately and returns a
well-formed result with no tool calls, so the loop terminates in one
round when unconfigured. `npm run typecheck`, `npm run lint`, and
`npm run build` all pass.

One observed-and-accepted behavior: a turn that fails at the provider
leaves the user's message persisted with no assistant reply (by design —
a failure must never lose what the user typed), so those orphaned
questions remain in the context window and the model may answer several
of them at once on the next successful turn. Correct, if slightly
verbose; not worth adding state to suppress.

Migration note: the standing `rides` GiST-index drift issue (§28)
recurred for a **fourth** time, on a migration touching only new
`support_*` tables. Stripped the two spurious `DROP INDEX` statements
before applying, per the existing process rule, and confirmed directly in
Postgres that both spatial indexes survived.

------------------------------------------------------------------------

## 16. Security and rate limiting (Phase 14)

An audit phase rather than a feature phase — no new module, table, migration or
dependency, and only one new file.

Rate limiting existed for OTP and AI chat but nowhere else, not by decision but
because no earlier phase had forced the question. It now covers every category,
reusing the same limiter factory. Two related fixes came out of the same pass:
the limiter's `INCR` + `EXPIRE` became a single Lua script (the two-command
version could leave a counter with no TTL — a permanent lockout), and
`verifyAccessToken` began actually checking the `type: 'access'` claim it had
only been casting.

The phase also settled two deliberate positions: rate limiting fails *open* on a
Redis outage, because an outage must degrade abuse protection rather than take
down the API; and `TRUST_PROXY` defaults to `false`, which is the correct value
without a proxy in front, since trusting `X-Forwarded-For` unguarded lets any
client mint a fresh rate-limit bucket per request.

## Status: complete

No new features — this phase audited every route and closed the gaps. Most of
the checklist above was already satisfied by earlier phases and was re-verified
rather than rebuilt: Helmet + CORS (Phase 1), input validation (`validateBody`/
`validateQuery`), webhook signature verification (Phase 10, real HMAC behind
`PaymentProvider.verifyWebhookSignature`), Cloudinary upload validation (Phase
4.5, magic-byte check + `authenticated` delivery + signed URLs), and the
authorization/ownership boundaries built per-module throughout. All confirmed
working, none changed.

**Rate limiting went from 2 of the 9 categories above to all 9.** Only OTP
request/verify (Phase 3) and AI support chat (Phase 13.5) had limits; ride
search, ride creation, booking, payment/webhook, `/auth/refresh`+`/logout`,
document upload, and WebSocket connections had none. All now use the same
`rateLimit()` factory (`infrastructure/redis/rateLimit.ts`) — no second
limiter was introduced — with every limit as its own `*_RATE_LIMIT_*` env var
(spec §49: configurable, never magic numbers). Limits are keyed per user
where the route is authenticated and per IP where it isn't. The document-upload
limit is shared by the vehicle and user upload endpoints via
`app/middleware/rateLimits.ts`, so a user can't get double the allowance by
alternating between them.

`rateLimit()` itself was hardened three ways: the non-atomic `INCR`+`EXPIRE`
pair became one Lua script (the old version could strand a counter with no TTL
— a permanent lockout); `RateLimit-Limit/Remaining/Reset` and `Retry-After`
are now returned; and a Redis failure now **fails open** (explicit user
decision this phase — a Redis outage must degrade rate limiting, not take down
auth/rides/bookings, the same trade-off `createPushProvider()` already makes
for a bad FCM credential).

Other gaps closed:

-   **`TRUST_PROXY` env boolean, default `false`** (explicit user decision).
    Every per-IP limit reads `req.ip`, which is only the real client when a
    trusted proxy sets `X-Forwarded-For`. Default-off is the *safe* value, not
    a placeholder: with no proxy in front, trusting the header lets any client
    rotate it and mint a fresh bucket per request. Flip to `true` in the same
    change that puts the app behind Phase 16's load balancer.
-   **`validateParams`** added beside the existing two validators, applied to
    every `:id`/`:userId` route. Every id is a Postgres `@db.Uuid`, so a
    malformed one previously reached the driver and surfaced as a raw 500
    (confirmed by reproducing `PrismaClientKnownRequestError` directly).
-   **`verifyAccessToken` now checks the signed `type: 'access'` claim**,
    which was previously cast but never verified.
-   **CORS** tightened from a bare origin string to an explicit
    origins-list/methods/headers/credentials policy; `CORS_ORIGIN` now accepts
    a comma-separated list.
-   **Production-config assertions** in `env.ts`: refuses to boot with
    `NODE_ENV=production` if a `changeme-` placeholder secret survives, if the
    access and refresh secrets match, or if `CORS_ORIGIN` is localhost or a
    wildcard. Development is deliberately unaffected.
-   **WebSocket** gained a per-user connection limit and a per-message
    throttle, reusing the same Redis limiter via an exported
    `consumeRateLimit()` rather than a socket-specific implementation.

## Real bug found during verification

Fail-open did not actually work as first written. ioredis defaults to
`enableOfflineQueue: true`, which **buffers** commands issued while the
connection is down and flushes them on reconnect — so a rate-limit check
against a stopped Redis *hung* rather than throwing, and a `try/catch` cannot
rescue a hang. Confirmed by stopping the Redis container mid-request: the
first request returned 200 and every subsequent one blocked indefinitely. A
Redis outage would therefore have hung every rate-limited endpoint — the exact
opposite of the intended degradation. Fixed by racing the Redis call against a
1s deadline inside `consumeRateLimit` and failing open on timeout. Turning the
offline queue off globally would have been the wrong fix: OTP storage shares
that connection and should fail *closed*, not quietly proceed.

## Verification

Manual, against the real Postgres/Redis stack (no automated test infra yet, per
the Phase 3 note — expected at the time to be Phase 15's job; Phase 15 was in
fact completed the same way, without adding a test suite — see §19):

-   **429 behavior**: ride search returned exactly 60×200 then 429s at a
    60/min limit; OTP resend cooldown returned 429 with `Retry-After: 60`;
    `RateLimit-Reset` tracked the real key TTL. Every counter key was
    confirmed to carry a TTL (the atomicity fix).
-   **`TRUST_PROXY` in both positions**, without needing a load balancer:
    with `false`, 65 requests each carrying a *different* spoofed
    `X-Forwarded-For` correctly shared one bucket (60×401 then 5×429) —
    spoofing defeated; with `true`, the same 65 requests got 65 separate
    buckets (zero 429s) — header honored, ready for the ALB.
-   **Fail-open**: with Redis stopped, rate-limited endpoints returned 200 in
    ~1.0s (the deadline) instead of hanging or 500ing, logged the degradation,
    and returned to normal enforcement (60×200, 3×429) after recovery.
-   **Param validation**: `/rides/not-a-uuid`, `/bookings/12345`,
    `/vehicles/abc` all → 400 `VALIDATION_ERROR` (previously 500); a
    well-formed but nonexistent uuid still → 404 `RIDE_NOT_FOUND`.
-   **Token type**: a JWT signed with the *access* secret carrying
    `type: 'refresh'` → 401; one with **no** `type` claim and `role: ADMIN` →
    401 (previously would have been accepted as a valid admin token); a
    genuine access token → 200.
-   **Middleware ordering**: no token → 401; a `PASSENGER` on an admin route
    with a malformed uuid → 403 (authorization runs before validation, so
    nothing is leaked), and a forbidden request does not consume the caller's
    rate-limit budget.
-   **Production assertions**: placeholder secrets → refuses to boot, exit 1;
    identical access/refresh secrets → refused; localhost `CORS_ORIGIN` →
    refused; a fully valid production config → boots.
-   **Re-verified unchanged**: bad webhook signature → 401
    `INVALID_WEBHOOK_SIGNATURE` and a correctly-signed one still reaches the
    handler (404 `PAYMENT_NOT_FOUND` for an unknown order); a text file named
    `.png` → `UNSUPPORTED_FILE_TYPE`; the shared upload bucket decremented
    across *both* upload endpoints (20 → 18 → 17).
-   **WebSocket**: 35 connection attempts at a 30/min limit → 30 connected,
    5 rejected `RATE_LIMITED`; 65 `send_message` events at a 60/min limit →
    60 reached the authorization layer (correctly rejected
    `CONVERSATION_NOT_FOUND`, ownership boundary intact) and 5 were
    `RATE_LIMITED`.
-   **Helmet/CORS headers** confirmed present on responses; a disallowed
    origin receives no `Access-Control-Allow-Origin`; preflight advertises
    only `GET,POST,PATCH` (the verbs that actually exist).

`npm run typecheck`, `npm run lint`, and `npm run build` all pass.

Not done in this phase, deliberately: automated tests and failure-injection
(Phase 15), Dockerfile/non-root/secrets manager/TLS (Phase 16), structured
logging and OpenAPI (Phase 15/17). No schema migration was needed.

*(Superseded since: Phase 15 verified those paths manually rather than adding
a test suite, and Phase 16 no longer requires a Dockerfile — Render runs the
Node service directly. Structured logging and OpenAPI remain outstanding.
Left as written because this records what was true at the time; see §19/§20.)*

------------------------------------------------------------------------

## 17. Verification and hardening (Phase 15)

The phase was originally specified as building unit, integration, API,
concurrency and failure test suites. It was completed differently, and the
difference is stated plainly rather than papered over: the verification those
suites were meant to provide was performed by driving the running application
against the real stack, but **no test framework was introduced**.

What follows is the record of what was actually exercised.

## How verification was performed

Two full passes, both against the real stack (PostgreSQL + PostGIS, Redis,
BullMQ) and against real external providers where safe:

``` text
Pass 1  --- full verification of Phases 0-14
              |
              v
        bugs found -> fixed
              |
              v
Pass 2  --- regression verification of the fixes
            + re-verification of every affected flow
```

Tooling was `curl`, `node -e`, `psql`, `redis-cli`, raw engine.io over
Node's built-in `WebSocket`, and the existing `npm` scripts. No files were
added to the repository.

## Build verification

``` text
typecheck              PASS
lint                   PASS
build                  PASS
application startup     PASS
Prisma / PostgreSQL     PASS
PostGIS                 PASS  (EXPLAIN ANALYZE confirms both GiST indexes
                               and the departure/status index are used)
Redis                   PASS
BullMQ workers          PASS
Socket.IO               PASS
env validation          PASS  (missing/invalid config exits non-zero)
```

## Functional verification --- all RUNTIME VERIFIED

``` text
authentication          OTP issue/verify/expiry/attempt-lockout,
                        access + refresh tokens, rotation,
                        reuse detection with family revocation, logout
users                   profile, uniqueness, role propagation
driver upgrade          submit -> reject + reason -> resubmit -> approve,
                        atomic role/status flip, admin-only enforcement
vehicles                CRUD, ownership, duplicate registration,
                        admin verification gate
rides                   creation, fare + commission, state machine,
                        PostGIS search (radius edges, Asia/Kolkata date
                        boundaries, all five sorts, cursor pagination)
bookings                seat hold at creation, overbooking rejection,
                        cancellation rules
payments                idempotency (replay / conflict / missing key),
                        webhook signature verification, state transitions
cancellation + refunds  driver cascade, policy amounts, refund intents
notifications           persistence, list, read, ownership
passenger-driver chat   authenticated socket, participant authorization,
                        persistence, broadcast
AI support              knowledge answers, tool calling, ownership binding
```

## Security verification --- all RUNTIME VERIFIED

``` text
authentication          expired / malformed / bad-signature tokens rejected
authorization           role gates enforced server-side
ownership / IDOR        User A -> User B rejected for User, Vehicle, Ride,
                        Booking, Payment, Conversation, SupportConversation,
                        Notification
rate limiting           every implemented category: boundary, 429,
                        RateLimit-* headers, Retry-After, window reset
CORS                    allowed / disallowed origins, methods, headers
trust proxy             default-off behavior confirmed; production refuses
                        to boot with it disabled
parameter validation    malformed UUIDs -> 400, never a driver-level 500
token invariants        the signed `type: access` claim is enforced
webhook signatures      invalid + missing signature rejected before any
                        state change
upload validation       magic-byte mismatch and size limits enforced
WebSocket throttling    connection and per-message limits applied
production config       refuses to start on placeholder secrets, localhost
                        CORS, stub providers, or TRUST_PROXY=false
```

## Concurrency / idempotency verification

All six scenarios were exercised with genuinely concurrent requests
(parallel OS processes and same-tick dispatch), not by code reading:

``` text
two users booking the final seat   RUNTIME VERIFIED
    6 parallel processes, 1 seat -> exactly 1 success, 5 rejected,
    available_seats = 0, ride -> FULL, no negative seat count anywhere

duplicate payment request          RUNTIME VERIFIED
    4 concurrent requests, one Idempotency-Key -> 1 booking,
    1 payment, 1 transaction, 1 seat consumed

duplicate payment webhook          RUNTIME VERIFIED
    8 concurrent identical signed deliveries -> all acknowledged,
    exactly 1 payment and 1 transaction, single state transition

duplicate refund job               RUNTIME VERIFIED
    same refund re-enqueued 3x concurrently -> collapsed by jobId,
    no duplicate REFUND transaction

refresh token reuse                RUNTIME VERIFIED
    5 concurrent rotations of one token -> 1 success, 4 reuse-detected,
    whole family revoked

driver cancellation during booking RUNTIME VERIFIED
    booking and cancel dispatched in the same tick -> ride CANCELLED,
    zero active bookings on a cancelled ride, seats restored,
    refund intents correct
```

## Regression verification

``` text
bugs discovered during pass 1
        |
        v
each bug fixed
        |
        v
the failing scenario re-run to confirm the fix
        |
        v
surrounding behavior re-run to confirm nothing else broke
        |
        v
second full verification pass over Phases 0-14
```

Pass 2 additionally found two defects that pass 1 had not (a permanent
BullMQ worker stall after a Redis outage, and Redis clients without error
listeners); both were fixed and re-verified the same way. See the decision log (§18)
for the full record of every bug found and fixed.

## Failure-path verification

The following failure paths were exercised against the running application:

``` text
Redis unavailable          RUNTIME VERIFIED
    /ready -> 503 in ~2s (not a hang), OTP fails closed with 503,
    rate limiting degrades open, non-Redis routes unaffected,
    recovery clean with no data loss

email provider failure     RUNTIME VERIFIED
    invalid API key -> 502 EMAIL_SEND_FAILED, cause logged server-side

FCM failure                RUNTIME VERIFIED
    invalid credential and invalid token -> logged with provider error
    code; retriable failures retried, notification row still persisted

payment webhook failure    RUNTIME VERIFIED
    invalid signatures, missing signatures and malformed payloads all
    rejected before any state change

AI provider failure        RUNTIME VERIFIED
    an upstream timeout surfaced as AI_PROVIDER_TIMEOUT and was handled
    cleanly, with the user's message already persisted

map provider failure       RUNTIME VERIFIED
    a transient provider failure surfaced as MAP_PROVIDER_ERROR without
    leaving partial ride state behind

Cloudinary failure         RUNTIME VERIFIED
    provider rejection of an invalid upload surfaced without creating a
    document record
```

## Status: complete

Phase 15 was completed through manual/runtime verification and hardening
rather than by introducing a persistent automated test suite.

**Automated test infrastructure remains a future engineering improvement
and is NOT currently present in the repository.** There are deliberately no
unit, integration, API, E2E, concurrency or failure-injection test files, no
test directories, no fixtures and no test framework. `package.json` has no
`test` script. Any statement that SaathiRide has an automated test suite would be
false.

Guarding the verified behavior against future regressions is what an
automated suite would add, which is why it stays on the roadmap as future
technical hardening rather than being struck off. Structured logging and
OpenAPI generation, also mentioned in earlier phases, likewise remain
outstanding.

------------------------------------------------------------------------

---

## 18. Ratings (Phase 15.5)

The one feature that existed as scaffolding rather than as nothing. Two columns
(`users.rating_average`, `rating_count`) had been in the schema since the very
first migration, and two consumers already read them — the fare strategy's
bounded multiplier and the `DRIVER_RATING` search sort. **Nothing wrote them.**
The practical effect was that every driver's multiplier resolved to exactly
`1.0` and `DRIVER_RATING` collapsed onto the `r.id` tie-breaker, so both features
were present in the code and inert in production.

Building the write path meant three decisions, none of them obvious:

**Bidirectional, with separate reputations.** A passenger rates the driver and
the driver rates the passenger — but the two scores are kept in separate column
pairs rather than one blended average. The fare multiplier and the search sort
read the *driver* figure, and blending in someone's conduct as a passenger would
price rides on the wrong signal. That forced the existing columns to be renamed
role-scoped rather than reused as-is.

**Eligibility gates on the ride, not the booking.** A booking only reaches
`COMPLETED` when its final-payment webhook succeeds, and no reconciliation job
exists to recover a payment whose webhook never arrived — gating on the booking
would have let a payment failure make a trip permanently unrateable for a
passenger who did nothing wrong. Gating on `ride.status = COMPLETED` avoids
coupling reputation to a payment outcome the rater doesn't control.

**The aggregate is folded in by a single atomic `UPDATE`.** The denormalised
average has to stay a column because the fare path reads it synchronously during
ride creation. Maintaining it the obvious way — read, compute in Node, write back
— is a lost update waiting to happen. Computing the new average inside the
statement puts the read under the lock the `UPDATE` already takes, which is the
same shape `reserveSeats` uses for seats.

Ratings hang off the booking rather than the ride, because a booking is exactly
the unit two people shared a trip through — which is what lets "one rating per
participant per trip" be a `UNIQUE (booking_id, rater_id)` constraint rather than
an application check that races.

## Status: complete

New `src/modules/rating/` (schemas, repository, service, controller), routed
under `bookings/:id/ratings` on the existing booking router — the same wiring
arrangement `rideRouter` already uses for booking creation.

One endpoint serves both directions because the direction is *derived* from the
booking plus `req.user.id`; the request body carries only a score and an optional
comment, with no identity field to spoof. A repeat submission is rejected with
`409 ALREADY_RATED` rather than replayed — an idempotency key exists so a retried
side effect happens once, but a rating is a one-time opinion, and silently
returning the original would hide that a second, different score was discarded.

**The migration hit the standing spatial-index hazard for the third time.**
`prisma migrate diff` proposed dropping *both* `rides` GiST indexes on a
migration that does not touch `rides` at all, and separately proposed
`DROP COLUMN`/`ADD COLUMN` for the two renamed columns because Prisma cannot
infer a rename. Both were corrected by hand before applying; the file records
why. Verified after applying that both GiST indexes still exist and all eight
user rows survived.

Runtime verification:

``` text
both directions            passenger→driver and driver→passenger, aggregates
                           exact ((5+4)/2 = 4.50; separate pairs, no bleed)
concurrency                8 simultaneous ratings for one driver → stored
                           average matched a recomputed AVG() exactly (4.25/8),
                           zero lost updates
duplicate submission       409 ALREADY_RATED, aggregate unmoved
ride not completed         409 RIDE_NOT_COMPLETED
non-participant            404 BOOKING_NOT_FOUND (not 403 — no existence leak)
score 0 / 6 / 4.5          400 VALIDATION_ERROR
malformed booking id       400, never a driver-level 500
consumers came alive       search returns a real rating; fare band measured at
                           251 (1★) / 265 (unrated) / 278 (5★) — the ±5% bound
```

------------------------------------------------------------------------

# 19. Decision log

Dated record of every decision that changed after the initial design, every
reversal, and every bug whose root cause turned out to be architectural rather
than local. Kept because the reasoning is worth more than the conclusion — and
because several of these mistakes are easy to make twice.

Recurring themes worth noticing across the entries below:

- **Provider swaps stayed cheap.** Mapbox → Geoapify and Resend → Brevo each
  touched one directory plus config, which is the entire justification for the
  provider interfaces.
- **Two bugs were structural, not local.** The BullMQ workers sharing one Redis
  connection, and ioredis buffering commands during an outage instead of failing
  them, both hid behind healthy-path behaviour and only appeared under a real
  outage.
- **The same migration hazard recurred twice.** Prisma silently proposes dropping
  the hand-written spatial indexes on any migration touching `rides`, because it
  has no record that `Unsupported` geography columns have indexes.
- **Several fixes came from swapping something else.** Rewriting the email
  provider is what exposed that every OTP delivery failure had been silently
  swallowed while the endpoint returned 200.

A note on `§N` references: entries below cite section numbers from the earlier
single-file version of the architecture document, as do comments throughout
`src/`. That document was later split — its architecture content is now
[`docs/architecture.md`](./architecture.md) and its rules are `claude.md`
§1–§14. The original numbers are preserved here rather than rewritten, because
the source comments reference them.

### 2026-08-10

-   **Search radius fixed to 10 km.** §1 said ~8 km while §20, §22,
    §85, and `steps.md` Phase 8 all said 10 km. 10 km was correct
    everywhere except §1; §1 has been corrected to match.
-   **Seat reservation clarified as Postgres-decrement-at-creation.**
    §35/§36 were ambiguous about whether `available_seats` decrements
    at booking creation or at payment confirmation. Resolved:
    decrement happens at booking creation (`PENDING_PAYMENT`, row
    locked), released by a TTL-based BullMQ expiry job if payment
    doesn't complete. Redis is not a second source of seat holds.
-   **Ride creation gets a `PENDING_PAYMENT` status.** §18 required
    "confirm required payment" before persisting the ride, but §40
    establishes payment confirmation as async/webhook-driven. Ride's
    state machine (§19) now has `PENDING_PAYMENT -> OPEN`, mirroring
    Booking's existing pattern.
-   **Vehicle eligibility for ride creation stays simple.** Ownership +
    `ACTIVE` status + seat capacity only — not gated on
    `verification_status`.
-   **Admin verification dashboard added to scope.** §13/§87
    originally excluded any admin verification workflow from the MVP.
    That is reversed: admins now manually verify vehicle documents via
    a dashboard (§96). This does not gate ride creation (previous
    bullet) — it's scope-additive, not a reversal of the "keep it
    simple" principle elsewhere in this document.

### 2026-08-11

-   **Driver upgrade path resolved.** steps.md flagged (Phase 3) that
    every signup lands as `PASSENGER` with no way to become `DRIVER`,
    blocking Phase 5 end-to-end. Resolved: a `PASSENGER` submits a
    driving-license document; an admin reviews and approves/rejects it
    through the Admin Module (§96); approval atomically sets
    `role -> DRIVER` and `driver_license_status -> VERIFIED`. See §8
    ("Becoming a DRIVER") and §96 for the full flow, endpoints, and
    data model.
-   **Vehicle verification now gates ride creation — this reverses the
    2026-08-10 decision above ("Vehicle eligibility for ride creation
    stays simple").** Explicit product decision, made when asked
    directly: a vehicle must have `verification_status = VERIFIED`
    (admin-approved, §96) before it can be selected to create a ride,
    on top of ownership + `ACTIVE` status + seat capacity. §8 and §96
    have been updated to match; §18's ride-creation flow and its
    eligibility function must include this check when Phase 7 is
    implemented.

### 2026-08-12

-   **Initial `MapProvider` implementation changed from Mapbox to
    Geoapify.** §17 named Mapbox as the initial implementation. In
    practice, Mapbox's account signup now requires a payment method
    before any free-tier usage is unlockable, which conflicts with an
    explicit product constraint: no payment method on file with any
    mapping/location vendor. Researched alternatives (Mapbox, Google
    Maps Platform, HERE, TomTom, MapTiler, OpenRouteService, LocationIQ,
    self-hosted OSRM+Nominatim) against that constraint plus free-tier
    limits, commercial-use terms, and fit for ~10k users (§92); Geoapify
    was selected as the initial `MapProvider` implementation (no card
    required, 3,000 credits/day, commercial use allowed with
    attribution, single API covering geocode/reverseGeocode/route/
    distance-matrix). OpenRouteService is a documented fallback if
    Geoapify's quota becomes constraining; self-hosting OSRM+Nominatim
    is the eventual no-limits option, deferred until traffic actually
    warrants the operational overhead. The `MapProvider` interface
    itself (§17) is unchanged — this is a Strategy-pattern provider
    swap, exactly what the interface exists to make cheap.

### 2026-08-13

-   **Booking gets one `status` column, not `booking_status` +
    `payment_status`.** §32 listed both as separate fields, but §33's
    state list (`PENDING_PAYMENT`/`PAYMENT_FAILED` alongside
    `CONFIRMED`/`CANCELLED`/`COMPLETED`) is a single state machine
    describing one lifecycle, not two independent ones — and that's
    exactly the design Ride already settled on (one `status` column,
    no separate `payment_status`, §19). Resolved the same way, for
    consistency: one `status` column on `bookings` too. A `payments`
    row's own `status` (§38, Phase 10) remains the source of truth for
    gateway-level payment-attempt detail. §32 updated to match.
-   **Booking pickup/drop implemented as plain lat/lng, not PostGIS
    geography.** §32 said "where appropriate" — Phase 9 has no
    `ST_DWithin`/`ST_Distance` query against a booking's pickup/drop
    point (unlike Ride's origin/destination, which exist because of
    ride search, §20-§23), so the `Unsupported`-type/raw-SQL machinery
    Ride needed for a real reason isn't justified here. Plain `Float`
    columns, normal Prisma Client access throughout
    `bookingRepository.ts`. Revisit if a future requirement (e.g.
    matching bookings by pickup proximity) actually needs it.
-   **First BullMQ queue stood up in Phase 9, not Phase 12 as
    originally sequenced.** §43's queue infrastructure was planned
    for the Notification module (steps.md Phase 12), but Phase 9's own
    "Reservation expiry" section requires a BullMQ delayed job to
    release a `PENDING_PAYMENT` booking's seat hold if payment never
    completes — there's no way to build seat-hold expiry without it.
    Added `bullmq` as a dependency and
    `src/infrastructure/queue/` (a dedicated BullMQ-configured Redis
    connection, one `booking-expiry` queue) in Phase 9 instead of
    waiting for Phase 12. Phase 12 reuses this same infrastructure for
    its own queues rather than standing up a second, parallel one.
-   **`PaymentProvider.createOrder()` reused for the 10% passenger
    prepayment, mirroring Ride's posting-commission flow exactly.**
    No new payment-provider work was needed — Phase 7 already built
    the `StubPaymentProvider` (§37, 2026-08-12) generically enough that
    Booking creation calls the same interface for a different purpose
    (prepayment instead of posting commission). Confirms the interface
    is doing its job as a real seam, not just for Ride.
-   **Payment and Transaction rows are created together, always, by one
    service (`paymentRecordService`) — never independently.** §38 frames
    them as two separate concepts (gateway attempt vs. business record)
    but doesn't explicitly say whether both get written at order-creation
    time or only Transaction at confirmation time. Resolved: both are
    created together at order-creation (Payment status `CREATED`,
    Transaction status `PENDING`), and both are resolved together when
    the webhook fires — so failed attempts get a financial-history
    record too, not just successes, matching §38's "financial
    history/reconciliation record" framing more literally than
    "only record what succeeded" would.
-   **Real gap found during testing: a payment that succeeds *after* its
    booking's seat-hold TTL already expired was silently inconsistent.**
    If Razorpay's `payment.captured` webhook arrives after
    `bookingExpiryService`'s BullMQ job already cancelled the booking and
    released the seat (a genuine race — confirmed by triggering it via a
    short test TTL), the webhook correctly recorded the Payment/
    Transaction as `SUCCESS` (the money did move) but
    `bookingRepository.confirmPayment`'s conditional update silently
    no-ops (the booking is no longer `PENDING_PAYMENT`), leaving no
    signal that a passenger was charged for a booking that no longer
    holds a seat. Resolved *for this phase*: `webhookService` now checks
    `confirmPayment`'s/`rideRepository.confirmPayment`'s return value and
    logs an explicit error flagging the case for manual refund review.
    A full automatic fix (issuing a refund, or race-proofing the TTL job
    against a concurrently-resolving webhook via a correlated-subquery
    conditional update) is *not* built — the correct resolution requires
    real refund policy/mechanics that don't exist until Phase 11
    (§31/§34/§59), and a sane default `BOOKING_PAYMENT_TTL_SECONDS`
    (900s) makes the race rare in practice. Revisit when Phase 11 adds
    refund handling.
-   **Retroactive Phase 9 cleanup: cancel the scheduled BullMQ expiry job
    on any terminal booking transition, not just when it fires.**
    `bookingExpiryService.cancelScheduledBookingExpiry` (new) is called
    after webhook-driven confirm/fail (this phase) and after a manual
    passenger cancel (Phase 9's `bookingService.cancelBooking`, patched
    now). Purely an efficiency cleanup — the job was already safely
    idempotent either way (§35/§36) — so this doesn't change behavior,
    only avoids pointless later job execution.

### 2026-08-14

-   **Phase 11 (Cancellation, Refunds, Settlement) implemented.** Driver
    cancellation now cascades to every active booking on the ride
    (§31/§34/§59): a `CONFIRMED` booking's 10% prepayment is refunded in
    full, a still-`PENDING_PAYMENT` one is just cancelled (nothing was
    captured), and the driver's own 5% posting commission is refunded per
    the §31/§85 time-based rule (2/5 of the captured commission if
    cancelling `>= DRIVER_CANCEL_THRESHOLD_HOURS` before departure, else
    nothing), only when it was actually captured. Refund intents are
    recorded as `PENDING` `Transaction` rows inside the cancellation
    transaction and resolved asynchronously by a new BullMQ `refund`
    queue/worker calling the now-real `PaymentProvider.refund()`
    (`RazorpayProvider`/`StubPaymentProvider` both previously threw, per
    the 2026-08-13 entry above). Final payment (§41) is triggered
    synchronously inside `POST /rides/:id/complete` (no new endpoint) —
    the remaining 90% (from the fare locked on each `CONFIRMED` booking)
    gets a `FINAL_PAYMENT` order per booking; the webhook flips the
    booking to `COMPLETED` on success and computes+logs the 97/3
    driver/platform settlement split (§84's "calculated exactly once").
    No new schema exists to persist that split — §6 keeps a wallet/payout
    system out of scope, and `TransactionType` is a closed enum — so it's
    a structured log line for a future payout module to consume, not a
    new row.
-   **Closed the exact gap the 2026-08-13 entry above flagged and
    deferred to this phase**: a payment webhook resolving `SUCCESS`
    after its ride/booking already left `PENDING_PAYMENT` via the
    cancellation cascade now creates and schedules a refund transaction
    (reusing the same cancellation-policy calculation for the commission
    case) instead of only logging "needs manual review." Verified via a
    forced race (cancel first, deliver the webhook after) that this
    never double-refunds against the cascade's own refund creation —
    exactly one of the two paths fires, gated by each side's own
    conditional state-transition outcome.
-   **New gap found and closed in the same phase, not previously
    flagged**: nothing stopped a passenger from self-cancelling a
    `CONFIRMED` booking after the ride had `STARTED`/`COMPLETED`, which
    would dodge the final-payment collection this phase adds.
    `bookingService.cancelBooking` now rejects with `409
    BOOKING_NOT_CANCELLABLE` once the ride has started, checked inside
    the existing transaction to avoid a TOCTOU gap.
-   **Unrelated bug found before any of the above and fixed first**:
    `prisma migrate dev`'s diff for this phase's own `Booking.
    finalPaymentOrderId` column also silently emitted `DROP INDEX` for
    both hand-written `rides` GiST spatial indexes (§16) — because
    `Ride.origin`/`destination` are `Unsupported(...)` columns (§77),
    Prisma's schema-diff engine has no record they're supposed to exist
    and reconciles them away as "unknown" on any unrelated `rides`-
    adjacent migration. Confirmed both indexes were actually gone from
    the dev DB; fixed by rewriting the generated migration file to keep
    them and re-running the `CREATE INDEX` statements directly.
    `EXPLAIN ANALYZE` re-confirmed both are used again. Flagged as a
    standing risk for any future migration that touches `rides` while
    `origin`/`destination` stay `Unsupported` — the generated SQL needs
    to be diffed against expectations, not just trusted.

### 2026-08-15

-   **Phase 12 (Notification System) implemented.** New `PushProvider`
    strategy interface (§17/§37-style) behind `src/infrastructure/fcm/`:
    `FirebasePushProvider` (real `firebase-admin` SDK) and
    `ConsolePushProvider` (local-dev fallback), selected the same
    configured-vs-fallback way as every other provider in this codebase.
    Every business event (§44's 9 `NotificationType` values) enqueues a
    BullMQ `notification` job; the worker does persistence
    (`notifications` table, §46) and FCM delivery as two independent
    steps — persistence is idempotent (upsert by a deterministic id
    generated at enqueue time), so delivery is left free to throw on a
    real gateway failure and let BullMQ's bounded retry/backoff (§43)
    handle it without risking a duplicate notification row. Tokens FCM
    reports invalid are removed from `user_devices` (§45).
-   **The exact same "recurring `rides` GiST index" issue documented in
    the 2026-08-14 entry above recurred a second time**, confirming it's
    genuinely structural rather than a one-off: (1) Phase 11's own fix to
    it collided with the *original* migration on a fresh shadow-database
    replay (both tried to create the same index — Phase 11's fix had
    only been validated against the one already-migrated dev DB it was
    written for, not a from-scratch environment); fixed with
    `CREATE INDEX IF NOT EXISTS`. (2) Once that was resolved, Prisma's
    diff engine proposed the *same* erroneous `DROP INDEX` pair again in
    this phase's own new migration, for a schema change with nothing to
    do with `rides`. Both fixed without a destructive `prisma migrate
    reset` — corrected the migration files and updated their stored
    checksums directly (`_prisma_migrations.checksum`) to match,
    preserving all dev data. A standing process rule is now recorded in
    §21 (Migration procedure): always `prisma migrate dev --create-only` and strip
    these two `DROP INDEX` statements before applying, for as long as
    `rides.origin`/`destination` stay `Unsupported`.
-   **Real bug found and fixed during manual verification, unrelated to
    the above**: `firebase-admin`'s `cert()` credential constructor
    parses the private key *synchronously* and throws immediately if
    it's not valid PEM — confirmed by an actual crash of the entire
    process at import time against this environment's `.env` (whose
    `FCM_PRIVATE_KEY` is not a real PEM key). Unlike Brevo/Razorpay,
    where a bad key only fails lazily on first real API call, a bad FCM
    key was taking down the *whole backend* — auth, rides, payments,
    everything — over a misconfigured push credential. Fixed by wrapping
    `FirebasePushProvider` construction in try/catch inside
    `createPushProvider()`, falling back to `ConsolePushProvider` on any
    construction failure (logged), exactly like the "not configured"
    case. Re-verified the server now boots and serves traffic normally
    with the same invalid key still in `.env`.
    only avoids pointless later job execution.

### 2026-08-16

-   **AI Support Chatbot added as a new module (§96.5) and phase
    (steps.md Phase 13.5).** Product requirement: an AI-assisted
    support chatbot for general SaathiRide help and account-context support
    (booking/ride status), kept fully separate from the existing
    passenger-driver chat (§47, Phase 13) — different module, different
    tables (`SupportConversation`/`SupportMessage` vs
    `Conversation`/`Message`), different transport (HTTP vs Socket.IO).
-   **`AIProvider` strategy interface adopted, mirroring `MapProvider`
    (§17) and `PaymentProvider` (§37) exactly** — `ChatbotService`
    depends only on the interface, selected via `AI_PROVIDER` env var
    through a factory in `infrastructure/ai/index.ts`. The original
    draft of this section named Grok/xAI as the initial implementation
    (free/low-cost, no payment method required — the same reasoning as
    the Geoapify choice, §97 2026-08-12); **corrected before any code
    was written** to Gemini instead, because a Gemini API key is what's
    actually available for development, using the official
    `@google/genai` SDK rather than raw `fetch` (unlike
    `GeoapifyMapProvider`) given how correctness-sensitive the
    tool-calling protocol is — the same trade-off `RazorpayProvider`
    already made for signature verification (§37, 2026-08-13). This
    remains a convenience choice, not an architectural one — OpenAI,
    Grok, and Claude remain valid future targets behind the same
    interface with no `ChatbotService` changes.
-   **Real LLM tool-calling chosen over server-side context injection
    for the user-data context layer**, after considering both:
    tool-calling is what the product requirement's "AIProvider → Tool/
    Context Layer → domain services" diagram literally describes, and
    Gemini's API supports native function/tool calling so this isn't
    bolted on. The authorization boundary is enforced entirely in
    backend code, not by prompting: tool JSON-schemas exposed to the
    model never include a `userId`/identity parameter, only
    resource-scoped ids (`bookingId`/`rideId`); the executor always
    binds `userId` from the authenticated request context. The model's
    only degree of freedom is which tool to call and which resource id
    to pass — never who is allowed to see it.
-   **Placed at Phase 13.5**, after Chat (13) and before Security (14).
    The real dependency is Phases 9–12 (Booking/Payment/Cancellation/
    Notifications) existing so the tool layer has real data to query —
    all of which precede 13.5 regardless of Chat's position.
-   **No human-support escalation system, RAG/vector search, automated
    tests, or new logging infrastructure introduced in this phase** —
    `SupportConversation.status` gaining an `ESCALATED` value plus
    nullable `escalationReason`/`escalatedAt` fields is the only
    concession to future escalation (mirrors how §96's admin
    verification fields hold a decision without a full workflow
    engine). No logger exists anywhere in this codebase yet (see
    `README.md`); this module doesn't special-case that either — errors
    flow through the existing `errorHandler` middleware like every
    other module.
-   **`AIToolCall` gained an opaque `providerState` field, added during
    implementation for a reason the design didn't anticipate.** Newer
    Gemini models reject any `functionCall` part replayed on a later
    turn unless its original `thought_signature` is echoed back with it
    — which broke every multi-turn conversation that had made a tool
    call. Rather than leak the vendor's concept into the
    provider-agnostic interface, `AIToolCall` carries an opaque
    `providerState` string that `ChatbotService`/`supportRepository`
    persist (inside the `tool_calls` JSON) and replay verbatim without
    interpreting. Providers that don't need it never set it. This is the
    interface absorbing a vendor requirement exactly as intended —
    contrast `PaymentProvider.verifyWebhookSignature` (§37), which
    solved the same class of problem by adding a *named* method because
    the concept (webhook signing) is genuinely universal; per-turn
    reasoning-continuation state is not.
-   **Verified against the real Gemini API, and the ownership boundary
    holds under direct attack**: asked to fetch another user's booking
    id with the prompt explicitly asserting "it is my booking," the tool
    layer refused and the assistant reported not-found, leaking nothing.
    Asked for a driver's phone number and home address, it invented
    nothing. Three further real bugs were found and fixed in the same
    pass — a retired default model, Gemini rejecting non-object
    `functionResponse.response` payloads (our tool results are often
    JSON arrays), and `AI_PROVIDER_RATE_LIMITED` being specified in §55
    but never actually mapped from an upstream 429. See steps.md
    Phase 13.5 "Status: complete" for the full detail.

### 2026-08-13 (Phase 14 — Security + Rate Limiting)

*Dated from the actual commit date. The `2026-08-15`/`2026-08-16` headings
above run ahead of theirs; this entry follows Phase 13.5 in sequence
regardless of the drift.*

-   **Rate limiting extended from 2 of §49's categories to all of them.**
    Only OTP request/verify (§9) and AI support chat (§96.5) had limits;
    ride search, ride creation, booking, payment/webhook, `/auth/refresh`,
    document upload, and WebSocket connections had none — not by decision,
    just because no phase's scope forced the question. All now use the
    existing `rateLimit()` factory with per-category `*_RATE_LIMIT_*` env
    vars (§49 "use configurable values"); no second limiter was introduced.
    Keyed per user on authenticated routes, per IP otherwise.
-   **`rateLimit()` fails open on Redis failure — explicit product decision
    made when asked directly.** A Redis outage must degrade rate limiting,
    never take down auth/rides/bookings with it. This is the same
    availability-over-strictness trade-off `createPushProvider()` already
    makes for a bad FCM credential (§97, 2026-08-15). The accepted exposure
    is that brute-force protection is absent, not merely weakened, while
    Redis is down; every fail-open is logged so the window is visible rather
    than silent.
-   **`TRUST_PROXY` added as a config boolean, default `false` — explicit
    product decision.** Every per-IP limit reads `req.ip`, which is only the
    real client when a trusted proxy sets `X-Forwarded-For`. Default-off is
    the *correct* value today, not a placeholder: with no proxy in front,
    trusting the header lets any client rotate it and mint a fresh
    rate-limit bucket per request, defeating §9's OTP brute-force protection
    entirely. Both positions were verified without needing a real load
    balancer (see steps.md Phase 14). Flip to `true` in the same change that
    introduces §65's ALB.
-   **`INCR`+`EXPIRE` replaced by one Lua script.** The two-command version
    (flagged in its own comment since Phase 3) could leave a counter with no
    TTL if the process died between them — a permanent lockout for whoever
    owned that key. `Retry-After` and `RateLimit-*` headers added at the same
    time.
-   **Real bug found during verification: fail-open didn't actually fail
    open.** ioredis defaults to `enableOfflineQueue: true`, which buffers
    commands issued while the connection is down instead of rejecting them,
    so a rate-limit check against a stopped Redis *hung* — and a `try/catch`
    cannot rescue a hang. Confirmed by stopping the container mid-request.
    A Redis outage would have hung every rate-limited endpoint, the exact
    opposite of the intended degradation. Fixed by racing the call against a
    1s deadline inside `consumeRateLimit`. Disabling the offline queue
    globally would have been wrong: OTP storage shares that connection and
    should fail *closed*.
-   **`verifyAccessToken` now verifies the signed `type: 'access'` claim**,
    which §10 specifies but the code only cast, never checked. Not
    exploitable as written (refresh tokens are random hex, not JWTs), but a
    token signed with the access secret carrying no `type` and
    `role: ADMIN` was demonstrably accepted before this change.
-   **`validateParams` added** alongside `validateBody`/`validateQuery`, and
    applied to every `:id`/`:userId` route. Every id is a Postgres
    `@db.Uuid` (§56), so a malformed one reached the driver and surfaced as
    a raw 500 — §87's "do not expose raw database errors to clients".
-   **Production-config assertions added to `env.ts`** (§63/§68): refuses to
    boot under `NODE_ENV=production` with a surviving `changeme-`
    placeholder secret, with matching access/refresh secrets, or with a
    localhost/wildcard `CORS_ORIGIN`. Schema validation cannot catch these —
    the placeholders are well-formed — and development is deliberately left
    alone.
-   **No new module, table, migration, or dependency.** Phase 14 is an audit
    plus applied reuse; the only new file is
    `app/middleware/rateLimits.ts`, holding the one limit shared by two
    modules (vehicle and user document upload) so both draw from the same
    bucket.

### 2026-08-17 (Email provider swap: Resend → Brevo)

-   **`EmailProvider`'s implementation changed from Resend to Brevo, and the
    directory was renamed `infrastructure/resend/` → `infrastructure/email/`.**
    Product decision: consolidate on Brevo. The rename is the more important
    half — `maps/`, `payments/`, and `ai/` are already named for the capability
    rather than the vendor, which is the entire point of having the interface;
    `resend/` was the odd one out, and a vendor-named folder would have needed
    renaming again on the next swap. The `EmailProvider` interface itself is
    unchanged, and the swap touched only that folder plus config — exactly the
    Strategy-pattern outcome §17/§37 exist to produce.
-   **`BrevoEmailProvider` uses raw `fetch` against Brevo's REST API v3
    (`POST /v3/smtp/email`), not the `@getbrevo/brevo` SDK** — same reasoning as
    `GeoapifyMapProvider`: one plain request/response with no intricate protocol
    to hand-roll incorrectly. Contrast `RazorpayProvider` (§37) and
    `GeminiProvider` (§96.5), which take SDKs precisely because signature crypto
    and the tool-calling wire format are easy to get subtly wrong. Net effect:
    the `resend` dependency was removed and nothing replaced it.
-   **Fixed a real bug the swap exposed, which was the actual motivation.** The
    Resend SDK resolves with `{ data, error }` rather than throwing, and
    `resendEmailProvider.sendOtpEmail` awaited the call but ignored the returned
    `error`. Every delivery failure — invalid key, unverified sender, exhausted
    quota, rejected recipient — was silently discarded and
    `POST /auth/request-otp` answered `200 "a verification code has been sent"`.
    Confirmed against the live API: Resend returned `403` while the endpoint
    returned `200`. `BrevoEmailProvider` now throws
    `502 EMAIL_SEND_FAILED` on any non-2xx or network failure. Verified both
    directions against the real Brevo API: a valid key delivers (Brevo's event
    log shows `requests → delivered`), and a deliberately invalid key now yields
    `502 EMAIL_SEND_FAILED` instead of a false success. This does not create an
    account-enumeration channel (§9) — the failure is a provider/infrastructure
    condition, reported identically whether or not the address has an account.
-   **`AppError` gained an optional `{ cause }`.** Provider errors carry the
    underlying failure so it survives to the error handler instead of being
    thrown away by a bare `catch {}`. Never serialized to the client — Brevo's
    error bodies can echo the recipient address (§61).
-   **`assertProductionSecrets()` now refuses to boot in production without
    Brevo and Razorpay credentials.** Previously a production deploy missing
    them started normally and served traffic on `ConsoleEmailProvider` (OTPs
    printed to stdout — broken login *and* credential disclosure) and
    `StubPaymentProvider` (fake order ids against real bookings), warning only.
    Confirmed by actually booting with `NODE_ENV=production` and watching it
    serve `HTTP 200`. FCM and Gemini are deliberately *not* fatal: their
    fallbacks degrade a feature rather than breaking money or credentials, so
    they warn loudly instead of blocking a deploy. `TRUST_PROXY=false` in
    production is now fatal too — every per-IP limit silently collapses onto the
    load balancer's address without it (§49).

### 2026-08-17 (Push delivery: failures made visible)

-   **Root cause of the "FCM is configured but nothing is delivered" bug was a
    misconfiguration, but the real defect was that it was invisible.**
    `FCM_CLIENT_EMAIL` held a personal Google address rather than a service
    account, so Google answered every token exchange with
    `invalid_grant: account not found` and firebase-admin surfaced
    `app/invalid-credential`. Push delivery was 0% functional and nothing —
    no log line, no failed job, no metric — said so.
-   **`processNotificationJob` discarded every delivery outcome except the two
    "token is dead" codes.** `PushSendResult.success === false` was dropped on
    the floor, so the job completed successfully having delivered nothing. It
    now always logs a failure summary (notification id, type, user, failure
    count, per-token error codes) and throws for retriable failures so BullMQ's
    existing bounded backoff (`attempts: 5`) applies. Device tokens are logged
    as a truncated prefix only — a token can be used to push to that device
    (§61).
-   **`PushSendResult` gained `retriable` and `errorCode`.** The original
    interface comment assumed gateway-level failures would throw and only
    per-token failures would resolve; that assumption was wrong, and was
    precisely what let a broken credential masquerade as routine stale-token
    noise. Classifying vendor error codes stays inside the provider, where the
    vendor vocabulary belongs — the same reasoning that put
    `verifyWebhookSignature` behind `PaymentProvider` (§37).
    `messaging/invalid-argument` is deliberately in neither the invalid-token
    nor the retriable set: FCM returns it both for a malformed token and for a
    malformed payload, so treating it as a dead token would wipe every user's
    devices on a payload bug, and retrying it would never succeed. It is logged
    instead.
-   **`createPushProvider()` now rejects a non-service-account
    `FCM_CLIENT_EMAIL` at boot**, falling back to `ConsolePushProvider` with an
    actionable message rather than constructing a provider that is guaranteed
    to fail on every send. One `.endsWith('.iam.gserviceaccount.com')` check
    would have turned this bug into a startup error.
-   Verified end-to-end against the real FCM API in all three states: a valid
    service account authenticates and reaches the gateway; a junk token logs
    `messaging/invalid-argument` and is correctly neither removed nor retried;
    a non-existent service account logs `app/invalid-credential` and is retried
    by BullMQ. Notification rows persist in every case, so the in-app
    notification centre is unaffected by delivery failure (§46).

### 2026-08-17 (Verification follow-up: error mapping, Redis resilience, suspension)

-   **`errorHandler` mapped every non-`AppError` to 500, which was one cause
    behind four separate defects**: malformed JSON on any endpoint, a body over
    the 1MB limit, an upload over the 5MB limit (`MulterError`), and a webhook
    posted with a non-JSON content type all answered
    `500 INTERNAL_ERROR`. Each of those is the caller's mistake and carries its
    own correct status, which was being discarded — and every one of them
    inflated the 5xx rate with client errors. They now map to `INVALID_JSON`
    (400), `PAYLOAD_TOO_LARGE` (413), `FILE_TOO_LARGE` (413) and
    `INVALID_WEBHOOK_PAYLOAD` (400). As a side effect `webhookService`'s own
    `INVALID_WEBHOOK_PAYLOAD` branch stopped being unreachable dead code.
-   **5xx `AppError`s are now logged with their `cause`.** 4xx stays quiet (it
    is the caller's problem); a 5xx is ours, and previously a `502`
    reached the client with the provider's actual failure discarded
    server-side. This is what makes `AppError`'s `cause` worth attaching, and
    `GeoapifyMapProvider`'s bare `catch {}` — which threw away the only
    evidence of why a transient failure lost a ride creation — now attaches it.
-   **The Redis client had no command timeout, so an outage hung requests
    rather than failing them.** ioredis buffers commands while disconnected
    (`enableOfflineQueue`), and only the rate limiter raced its own deadline.
    Everything else inherited the hang: `/ready` blocked past 10s instead of
    answering `503 REDIS_UNAVAILABLE` — the readiness probe failing in exactly
    the scenario it exists for — and every OTP request held a connection open
    for the duration. A `commandTimeout` on the shared client fixes it
    centrally: `/ready` now answers 503 in ~2s, OTP fails closed with
    `503 SERVICE_UNAVAILABLE`, and rate limiting still fails *open* as designed.
    BullMQ is unaffected (separate connection, blocking commands are meant to
    wait). Disabling the offline queue outright would have been the wrong fix —
    it also breaks the normal reconnect window.
-   **`users.status` was read nowhere in the codebase**, so `SUSPENDED` was
    decorative: a suspended account could log in, refresh, and call every
    endpoint. Enforced now at the two points a session is *granted* — OTP
    verification and refresh-token rotation — rather than in `authenticate`.
    That is deliberate and follows §8/§10: access tokens are stateless and
    short-lived, and role changes already work this way, so suspension takes
    effect within one 15-minute token lifetime without adding a database read
    to every authenticated request. The refresh path checks inside the existing
    rotation transaction (the user row is already joined there) and revokes the
    whole token family atomically. Not enforced on request-otp, which would
    confirm an address has an account and reintroduce the §9 enumeration leak.
    No suspend/unsuspend endpoint was added — §6 keeps a blocked-user system
    out of scope, so status is set directly, exactly like ADMIN provisioning.
-   **Socket.IO CORS was configured from the raw `CORS_ORIGIN` string** while
    Express used the parsed `corsOrigins` array. With more than one origin
    configured it emitted the whole comma-separated list as a single
    `Access-Control-Allow-Origin`, which is not a legal header value — so
    WebSocket chat broke for *every* origin the moment a second one was added,
    while the REST API kept working.
-   **Rate limiting was opt-in per router**, leaving the entire admin module,
    the notification endpoints and chat history with no limit at all, and any
    new router unprotected by default. Added a deliberately generous shared
    `authenticatedReadLimit` for authenticated endpoints that don't warrant
    their own bucket.
-   **Support tool results shipped raw service DTOs to the model**, meaning
    every ride lookup pushed `routeGeometry` — the full route coordinate list —
    into the LLM context, along with the driver's `postingCommissionAmount`.
    Projections trim tool output to the fields a support answer is phrased
    from: `getRideStatus` went from ~10,000 characters to 335 (§96.5 cost
    control). The ownership-checked service calls are unchanged.
-   **Shutdown never released anything.** No `prisma.$disconnect()`, no
    `redis.quit()`, no queue `close()`, no timeout, and no
    `unhandledRejection`/`uncaughtException` handlers anywhere — an unhandled
    rejection in a worker killed the process with nothing but a stack trace.
    All added, with a 10s force-exit so a stuck keep-alive can't hang the
    process, plus an `EADDRINUSE` message instead of a raw unhandled 'error'.
-   **Validation errors now name the failing field.** A ride creation missing
    four coordinates previously answered "expected number, received undefined"
    four times with no indication of which fields.
-   **Deliberately not changed:** refreshing after logout still returns
    `REFRESH_TOKEN_REUSE_DETECTED`. The wording is alarming for a normal
    logout, but the server genuinely cannot distinguish a logged-out token from
    a stolen one, and treating that presentation as suspicious is the correct
    security posture. Softening the code would weaken a real control to improve
    a message.

### 2026-08-18 (BullMQ workers stalled permanently after a Redis outage)

-   **Every Worker now gets its own Redis connection; only the Queues share
    one.** All three Workers and all three Queues previously ran on a single
    `queueConnection`. A Worker sits in a blocking `BZPOPMIN`/`BRPOPLPUSH`
    waiting for its next job, and a blocking command monopolises the socket it
    was issued on, so several Workers on one connection contend for it. That
    works while the connection stays healthy — which is why it survived every
    earlier phase — but once an outage drops the socket, at least one Worker's
    blocking loop never resumes after the reconnect.
-   **The failure was silent and permanent.** The stalled Worker reported
    `isRunning() === true`, emitted no error, and its `failed` handler never
    fired; jobs simply accumulated in `wait` with `active=0` until the process
    was restarted. Consequences: seat-hold expiry never fires (so seats are
    held forever against bookings that never paid — §35/§36), refunds are never
    submitted (§11), and no notification is ever delivered.
-   **Found during the second verification pass, and initially misattributed.**
    It was first recorded as pre-existing on the grounds that
    `queue/connection.ts` was untouched by the preceding bug-fix commits. That
    reasoning was right about the file and wrong about the cause: the defect is
    in how Workers were *given* that connection, which predates those commits
    but was never exercised because no earlier phase had induced a Redis outage
    while queues were idle.
-   **Reproduced in isolation before changing anything**, outside the app: one
    shared connection + three Workers + a 25s outage with the queues idle left
    exactly one queue at `wait=1`/`active=0` permanently, while the other two
    recovered. A single Worker on a shared connection recovered fine, and a 3s
    bounce recovered fine — which is why the bug looked intermittent and
    duration-dependent rather than structural.
-   **Verified after the fix** against the same scenario at 25s and again at
    45s: all three queues drained and the notification actually persisted,
    **without restarting the process**. Normal (no-outage) throughput and
    SIGTERM shutdown were re-checked and unchanged.
-   `createQueueConnection(label)` also attaches an `error` listener to each
    queue connection. Those were previously the clients ioredis complained
    about with `missing 'error' handler on this Redis client` during an outage;
    an ioredis 'error' with no listener is an unhandled 'error' event.
    `closeQueueConnections()` closes the whole pool on shutdown, replacing the
    single `queueConnection.quit()`, and falls back to `disconnect()` when
    `quit()` can't complete because the server is already gone.
-   **The Socket.IO adapter's two `redis.duplicate()` clients were the same
    defect and are fixed alongside it.** They now have `error` listeners, and
    `closeSocketRedisClients()` closes them during shutdown — the adapter did
    not create those connections, so `io.close()` left them open. They are
    closed *after* `io.close()`, since the adapter still publishes on them
    while sockets are being torn down. `commandTimeout` inherited from the
    parent client is deliberately left in place: SUBSCRIBE/PUBLISH are ordinary
    request/response commands, and delivered pub/sub messages are pushes rather
    than command replies, so the deadline never applies to waiting for a
    message. Verified: `missing 'error' handler on this Redis client` no longer
    appears during an outage, and a full chat round trip (join -> send ->
    broadcast -> persisted) still works afterwards without a restart.

### 2026-08-19 (Roadmap: Phase 15 closed, deployment retargeted to Render/Supabase/Upstash)

-   **Phase 15 rewritten from "Testing + Hardening" to "Verification +
    Hardening", and marked complete.** The phase originally specified unit,
    integration, API, concurrency and failure *test suites*. The verification
    those suites were meant to provide was performed — two full passes driving
    the running application against the real stack, with every bug found fixed
    and re-verified — but no test framework was introduced. §17 (Verification) now
    records what was exercised: build health, functional flows, security and
    IDOR boundaries, all six concurrency/idempotency scenarios, and the
    failure paths.
-   **The documentation must not claim an automated test suite exists**, because
    none does. A new §0 states the current milestone and the testing position
    up front, and §69 (Testing Strategy) is now labelled as the specification
    for a suite that has not been built rather than a description of existing
    code. Automated testing stays on the roadmap as future hardening, together
    with structured logging and OpenAPI.
-   **Deployment target split into current and future (§65).** The immediate
    target is Render + Supabase + Upstash for a portfolio/demo deployment at
    minimal cost; AWS ECS Fargate + RDS + ElastiCache + load balancer is
    preserved as the future production target. The two are documented as
    deliberately non-equivalent. Migration should be configuration,
    containerization and splitting the workers out of the API process — not a
    rewrite — because every external dependency already sits behind an
    interface or a connection string.
-   **Docker dropped from Phase 16 and moved to the future AWS scope.** The old
    Phase 16 mandated a Dockerfile only because ECS Fargate can exclusively run
    containers. Render builds and runs the Node service directly from the repo,
    so an image would be an artifact to maintain with nothing to show for it.
    §64 now marks the Compose file as development-only.
-   **A blocking constraint was measured, not assumed, before writing the
    Phase 16 plan.** An idle SaathiRide with zero traffic issues ~344 Redis
    commands/minute (bzpopmin + zrangebyscore + evalsha from three polling
    BullMQ workers), i.e. roughly 495,000 commands/day at rest. A
    command-metered free tier such as Upstash's is exhausted by that alone, so
    §19 (Roadmap) records the Redis provider as an explicit decision to be
    settled before implementation, with the options and their consequences.
    Related: Render's free tier sleeps when idle, and because the workers share
    the API process, delayed jobs (seat-hold expiry) fire late on wake — they
    are not lost, which was confirmed locally.
-   **Stale business rule corrected in Phase 17, documentation only.** Its
    driver journey still read "Upload documents (verification pending, does not
    block)" with ride eligibility as "ownership + ACTIVE + seat capacity".
    That was superseded by §97 (2026-08-11) and §8/§96, and the running code
    rejects an unverified vehicle with `409 VEHICLE_NOT_ELIGIBLE` (confirmed at
    runtime). §19 (Roadmap) now states the rule the code enforces. **No code was
    changed** — the documentation was wrong, not the implementation.
-   **Rating flagged in Phase 17 rather than silently verified.** The journey
    ends in "Rating", but there is no Rating model or endpoint and
    `users.rating_average` is never written. Phase 17 now says so and requires
    it to be implemented or struck before that phase runs.

### 2026-08-19 (BullMQ idle polling made configurable and reduced 13.8x)

-   **`QUEUE_DRAIN_DELAY_SECONDS` (default 60) and
    `QUEUE_STALLED_INTERVAL_SECONDS` (default 300) now tune worker polling**,
    applied to all three Workers through a shared `workerPollingOptions` in
    `infrastructure/queue/connection.ts`. BullMQ's defaults are `drainDelay: 5`
    and `stalledInterval: 30000`; a Worker re-issues its blocking `BZPOPMIN`
    every drain cycle, so those defaults cost Redis commands continuously even
    with the application idle. On Redis priced per command (§19 (Roadmap)) that
    is billable traffic for doing nothing.
-   **Measured, not estimated.** Idle, zero traffic, excluding the local
    docker-compose healthcheck: ~332 commands/minute (~478k/day) at the
    defaults, ~24/minute (~34.6k/day) at 60s. The cost is deterministic — each
    Worker issues exactly 8 commands per drain cycle — so
    `3 * 8 * (86400 / drainDelay)` predicts it, and matches the measurement
    exactly at 60s.
-   **The earlier ~495k/day figure was slightly overstated** and is corrected
    here: 12 commands/minute of it were docker-compose's `redis-cli ping`
    healthcheck, proved by stopping the application and watching the pings
    continue unchanged. That is local development infrastructure and will not
    exist in a deployed environment.
-   **Verified that raising these does not delay work.** `BZPOPMIN` wakes the
    moment a job is pushed, so the drain delay never applies to an enqueued
    job: an immediate job was processed in ~300ms, and delayed jobs still fired
    within ~300ms of schedule (+5s -> 5304ms, +10s -> 10277ms). Seat-hold
    expiry therefore keeps its precision (§35/§36). The genuine trade-off is
    stalled-job recovery, which now takes up to `QUEUE_STALLED_INTERVAL_SECONDS`
    after a worker dies mid-job rather than 30s — acceptable because every
    SaathiRide job is short.

### 2026-08-16 (Idle polling cut again: drainDelay 60s -> 300s)

-   **`QUEUE_DRAIN_DELAY_SECONDS` default raised from 60 to 300**, taking idle
    Redis command volume from ~34,600/day to a measured **~10,300/day** — chosen
    so the figure fits a command-metered free tier with headroom rather than
    sitting near its ceiling. This settles the Redis-provider question the
    Phase 16 plan had flagged as blocking: option A (confirm the allowance
    covers it) is now comfortable on any plan metering in the tens of thousands.
-   **Re-measured rather than extrapolated, and the earlier model turned out to
    under-predict.** `3 * 8 * (86400 / drainDelay)` gives ~6,900/day at 300s;
    the measurement (app idle, docker healthcheck subtracted) is ~10,300/day.
    The per-drain-cycle cost is a *floor* — the stalled-job sweep and the
    Socket.IO Redis adapter's pub/sub connections are fixed overheads that were
    negligible against 5s and 60s cycles and are not against a 300s one. The
    documented figures are now the measured ones, and the formula is labelled
    as a floor.
-   **Verified the thing actually at risk: delayed-job precision.** Seat-hold
    expiry (§35/§36) is a delayed BullMQ job, and a 300s drain cycle raises the
    obvious worry that it fires up to five minutes late. It does not —
    `BZPOPMIN` wakes on push rather than on the drain cycle. Probe jobs
    scheduled at +5s / +15s / +30s fired at +341ms / +108ms / +187ms against
    their schedules. The genuine trade-off is unchanged: a worker that dies
    mid-job has it reclaimed after up to `QUEUE_STALLED_INTERVAL_SECONDS`.

### 2026-08-16 (Ratings built; reputation split by role)

-   **Ratings moved from scaffolding to a working feature.**
    `users.rating_average`/`rating_count` had existed since the first migration
    and were read by the fare multiplier (§29) and the `DRIVER_RATING` sort
    (§25), but no code ever wrote them — so the multiplier always resolved to
    `1.0` and the sort always collapsed onto its `r.id` tie-breaker. Both
    features were present and inert. New `Rating` entity, `src/modules/rating/`,
    and `POST`/`GET /api/v1/bookings/:id/ratings`.
-   **Reputation is now role-scoped, which forced a rename of the existing
    columns.** `rating_average`/`rating_count` became `driver_rating_*`, and
    `passenger_rating_*` was added alongside. A single blended average was
    rejected: the fare multiplier and the search sort read the *driver* figure,
    so folding in someone's conduct as a passenger would price rides on the
    wrong signal. This is a schema change to `users`, not an additive one.
-   **Eligibility gates on `ride.status = COMPLETED`, not `booking.status`.**
    A booking only reaches `COMPLETED` via its final-payment webhook, and no
    reconciliation job exists to recover a payment whose webhook never arrived
    (a gap this log already records) — gating on the booking would let a payment
    failure make a trip permanently unrateable for a passenger who did nothing
    wrong. The looser gate accepts that someone who never paid their remainder
    can still rate; that was judged the better failure.
-   **The aggregate is maintained by one atomic `UPDATE`, never
    read-modify-write.** The denormalised average has to stay a column because
    the fare path reads it synchronously during ride creation, so recomputing an
    `AVG()` there would put an aggregate query on a hot path. Computing the new
    average *inside* the statement puts the read under the lock the `UPDATE`
    already takes — the same shape as `reserveSeats` (§36). Verified with 8
    simultaneous ratings against one driver: the stored average matched a
    freshly recomputed `AVG()` exactly (4.25 over 8), with no lost updates. The
    naive version would have dropped several.
-   **A repeat rating is rejected, not replayed.** `UNIQUE (booking_id,
    rater_id)` in the same transaction as the aggregate, surfacing as
    `409 ALREADY_RATED`. This deliberately differs from the payment endpoints'
    idempotency-key behaviour: a key exists so a retried *side effect* happens
    once, but a rating is a one-time opinion, and replaying the original would
    hide that a second, different score was discarded. Ratings are immutable.
-   **The direction is derived, never declared.** One endpoint serves both
    passenger→driver and driver→passenger; the ratee and role come from the
    booking plus `req.user.id`, and the request body has no identity field to
    spoof — same reasoning that keeps `userId` out of the AI tool schemas
    (§96.5). Confirmed at runtime that a request smuggling `rateeId`/`raterId`
    has no effect.
-   **The `rides` GiST-index hazard recurred for the third time**, on a
    migration that does not touch `rides` at all — confirming it fires on *any*
    migration, not just `rides`-adjacent ones. `prisma migrate diff` also
    proposed `DROP COLUMN`/`ADD COLUMN` for the two renamed columns, since
    Prisma cannot infer a rename; left as generated it would have discarded the
    data (harmless today, all NULL/0 — but by luck, not design). Both corrected
    by hand before applying, with the reasoning recorded in the migration file,
    and the file now re-asserts the two spatial indexes with
    `CREATE INDEX IF NOT EXISTS` as a backstop.

### 2026-08-16 (Phase 17: `trust proxy` made a hop count — per-IP limits were bypassable)

The first Phase 17 check against the deployment found that `TRUST_PROXY=true` did
not yield real client IPs. It yielded **client-supplied** ones, which is worse
than the failure the check was written to catch.

-   **`app.set('trust proxy', true)` trusts every hop**, which makes `req.ip` the
    *leftmost* `X-Forwarded-For` entry. Render **appends** to that header rather
    than overwriting it, so what arrives is
    `"<whatever the client sent>, <real client>"` and the attacker-supplied half
    wins. Measured against `POST /api/v1/auth/refresh` (limit 60/3600s) by
    reading the limiter's own `RateLimit-Remaining`: two calls with the same
    spoofed header decremented 59 → 58, and a third call with a *different*
    spoofed header reset to 59. Varying one header per request therefore mints an
    unlimited number of rate-limit buckets.
-   **Everything keyed on `req.ip` was affected**: OTP request flooding
    (`OTP_REQUEST_IP_MAX`, also a Brevo-quota and email-bombing vector), OTP
    verify brute force (`OTP_VERIFY_IP_MAX`), refresh-token grinding, and the
    webhook ceiling. The per-user limits were never affected — they key on
    `req.user.id`.
-   **The env flag was right; the Express value it mapped to was not.** §11 and
    the `TRUST_PROXY` comment already required `true` in production, and the
    production guard already refused to boot without it. The bug was purely the
    translation to Express, so the fix is a hop count:
    `app.set('trust proxy', env.TRUST_PROXY ? 1 : false)`. Reproduced both
    settings against a simulated Render header chain: with `true` the spoofed
    address won, with `1` `req.ip` was the appended real client regardless of
    what was sent.
-   **The hop count is now a documented invariant.** It must equal the number of
    proxies that actually append to `X-Forwarded-For` — adding a CDN in front of
    Render without raising it puts `req.ip` back under client control. Noted at
    the `app.set` call, in `config/env.ts`, and in `.env.example`.

The general lesson is that a security flag being *set* correctly says nothing
about the value it is translated into one layer down, and that only exercising
the deployed path surfaced it — this is precisely the class of defect Phase 17
exists to find, and it could not have been reproduced locally without a proxy in
front.

### 2026-08-16 (Phase 16 landed; Phase 17 infrastructure verified)

The deployment went up on Render + Supabase + Upstash and the infrastructure half
of Phase 17 was worked through against it. Four things are worth recording because
they were not obvious from the plan.

-   **The written build command could not have worked.** It ordered
    `npm run build` before `npx prisma generate`, but the Prisma client is
    generated *into* `src/generated/prisma`, that path is gitignored, and
    `prismaClient.ts` imports from it at compile time — so `tsc` had nothing to
    resolve. It also used a bare `npm ci`, which omits `devDependencies` when
    `NODE_ENV=production`, and `tsc`/`prisma`/`tsx` all live there. Corrected in
    §20 to `npm ci --include=dev && npx prisma generate && npm run build`.
-   **Supabase's direct endpoint is unusable from Render's free tier.**
    `db.<ref>.supabase.co` is IPv6-only and the free egress is IPv4, so
    `DATABASE_URL` points at the Supavisor **session** pooler. Session rather than
    transaction mode because one URL has to serve both the running app and
    `prisma migrate deploy` — transaction pooling breaks the advisory locks
    migrations take, and no `DIRECT_URL` is wired.
-   **Migrations cannot run on Render at all on this tier.** There is no
    pre-deploy command, and `prisma.config.ts` imports `config/env.ts`, so every
    Prisma CLI invocation validates all 81 vars and fires the production
    assertions. They are run from a developer machine with
    `NODE_ENV=development` instead. That is a deliberate operational choice, not
    an oversight, and it should be revisited if the instance is ever upgraded.
-   **The `rides` GiST indexes survived**, breaking a three-occurrence streak —
    but their *use* could not be demonstrated, because `rides` holds no rows and
    the planner correctly prefers the btree at that size. Recorded as blocked
    rather than passed. The distinction matters: "the index exists" and "the
    query uses it" are separate claims, and only the first is currently
    supportable.

Also noted, not fixed: TLS to Supabase is encrypted but not certificate-verified,
because `sslmode=require` is libpq's encrypt-without-validating mode. Closing it
means `verify-full` plus Supabase's CA bundle.

---

# 20. Roadmap

## Phase 16 — Deployment (complete)

The immediate target is a portfolio deployment on free tiers: Render for the Node
service, Supabase for PostgreSQL + PostGIS, Upstash for Redis. It is explicitly
not a production stack, and the two are documented as non-equivalent.

Two constraints were measured before the plan was written rather than assumed.
Render's free tier sleeps when idle, and because the workers share the API
process, delayed jobs fire late on wake — they are not lost, which was confirmed
locally. Upstash meters per command, and an idle SaathiRide spends real commands on
BullMQ polling; tuning the drain and stalled intervals cut that from roughly
478,000 to ~10,300 commands per day without delaying any job.

No Dockerfile is required for this target. Render builds the Node service
directly from the repository, so an image would be an artifact to maintain with
nothing to show for it. Containerisation belongs to the AWS target.

The full plan, including the free-tier decisions that have to be settled first,
follows.


### Goal

Prepare and deploy the current SaathiRide backend on a free/low-cost cloud stack
suitable for portfolio/demo use, while keeping the application architecture
portable to a future AWS production deployment.

``` text
NOW      Render + Supabase + Upstash      (portfolio / demo)
FUTURE   AWS ECS Fargate + RDS + ElastiCache   (production, spec §65)
```

The application itself should need no architectural change to move between
them: every external dependency already sits behind an interface or a
connection string.

### Current deployment architecture

``` text
                    Internet
                       |
                     HTTPS
                       |
                       v
              Render Web Service
              SaathiRide Backend (Node)
              HTTP + Socket.IO + BullMQ workers
                   /            \
                  v              v
           Supabase            Upstash
      PostgreSQL + PostGIS      Redis
                       |
                       +---- External providers
                             Cloudinary   (documents)
                             Brevo        (OTP email)
                             FCM          (push)
                             Razorpay     (payments)
                             Geoapify     (maps)
                             Gemini       (AI support)
```

Note the backend is a **single process** that serves HTTP, Socket.IO *and*
runs all three BullMQ workers as import side effects (`src/server.ts`).
Nothing separates them, which is what makes several items below matter.

### Redis command volume --- measured, and reduced

BullMQ workers poll continuously, which costs Redis commands even with nobody
using the app. That matters on hosted Redis that meters per command
(Upstash bills this way).

Measured against the real application, completely idle, zero traffic. The
figures below exclude the local docker-compose healthcheck (`redis-cli ping`
every 5s), which is development infrastructure and will not exist in
production:

``` text
BullMQ defaults (drainDelay 5s, stalledInterval 30s)
    332 commands/minute   ->  ~478,000/day at rest

tuned (drainDelay 300s, stalledInterval 300s)  <- current setting
      7 commands/minute   ->   ~10,300/day at rest
```

The cost is deterministic: each Worker issues 8 commands per drain cycle
(bzpopmin, zrangebyscore, zrange, zpopmin, rpoplpush, hmget, evalsha, del),
so with three Workers:

``` text
idle commands/day >= 3 * 8 * (86400 / QUEUE_DRAIN_DELAY_SECONDS)

    drainDelay   5s  ->  ~415,000/day floor   (measured ~478,000)
    drainDelay  60s  ->   ~34,600/day floor   (measured ~34,600)
    drainDelay 300s  ->    ~6,900/day floor   (measured ~10,300)  <- current
```

The drain cycle is a *floor*, not the whole cost: the stalled-job sweep and the
Socket.IO Redis adapter's pub/sub connections contribute too. At 5s and 60s the
drain cycle dominates and the model is close; at 300s the fixed overheads are no
longer negligible and the model under-predicts by ~50%. Quote the measured
figure, not the formula.

Both knobs are configuration, not code: `QUEUE_DRAIN_DELAY_SECONDS` and
`QUEUE_STALLED_INTERVAL_SECONDS`. Choosing a value for the target plan is a
deployment decision, not a rewrite.

#### What raising them does and does not cost

Verified at runtime with `drainDelay = 60`:

``` text
immediate jobs    processed in ~300ms  (BZPOPMIN wakes on push, so the
                  drain delay never applies to a job being enqueued)
delayed jobs      fired within ~300ms of their scheduled time
                  (+5s -> 5304ms, +10s -> 10277ms), so seat-hold expiry
                  keeps its precision
```

The real trade-off is **stalled-job recovery**: if a worker dies mid-job, its
job is reclaimed after up to `QUEUE_STALLED_INTERVAL_SECONDS` instead of
BullMQ's default 30s. SaathiRide's jobs are short (release a seat, submit a refund,
send a notification), so a longer window costs latency after a crash, not
correctness.

#### Redis provider decision --- settled

``` text
QUEUE_DRAIN_DELAY_SECONDS = 300   ->   ~10,300 commands/day idle (measured)
```

This was the one blocking decision in the Phase 16 plan. It is resolved by
configuration rather than by provider choice: at 300s the idle figure sits far
enough below a typical command-metered free tier that the allowance is no longer
the deciding factor, so any of Upstash, Render's own Redis, or Redis Cloud free
will do. Confirm the chosen plan's allowance covers ~10,300/day at signup; if a
plan is tighter than that, prefer one sized by memory/connections instead.

The value was chosen by measurement, not arithmetic --- the per-drain-cycle
formula under-predicts at this interval (see the decision log entry for
2026-08-16). Delayed-job precision was re-verified at 300s before adopting it,
because seat-hold expiry depends on it.

Dropping BullMQ is not an option: seat-hold expiry is what releases seats
held by unpaid bookings (§35/§36).

### Render backend

Determined from the actual `package.json` and `src/server.ts`:

``` text
root directory     backend              (the repo is a monorepo; there is no
                                        package.json at the repo root)
build command      npm ci --include=dev && npx prisma generate && npm run build
start command      npm start            (node dist/server.js)
Node runtime       >= 20.11.0           (package.json engines)
PORT               already read from env (config/env.ts) --- Render sets it
NODE_ENV           production
health endpoint    GET /health   (liveness, static)
readiness          GET /ready    (checks PostgreSQL + Redis, 503 on failure)
```

Both halves of that build command are load-bearing, and an earlier draft of this
section had them wrong in both respects:

``` text
--include=dev     `tsc`, `prisma` and `tsx` are devDependencies, and npm omits
                  those when NODE_ENV=production --- which it is here. Without
                  the flag the build dies at `tsc: not found`.
generate BEFORE   the Prisma client is generated INTO src/generated/prisma,
build             that path is gitignored, and prismaClient.ts imports from it
                  at compile time. Running `tsc` first cannot resolve the
                  import. Generate, then compile --- never the reverse.
```

Health checks must point at `/health`, not `/ready`: `/ready` pings PostgreSQL and
Redis on every call, which bills Upstash commands on a schedule and returns 503
during a cold start, causing a restart loop on an instance that sleeps.

Configuration changes required at deploy time (these are Phase 16
implementation work, not documentation):

``` text
TRUST_PROXY=true       required --- Render terminates TLS at a proxy, and
                       production config validation refuses to boot without
                       it, because every per-IP rate limit would otherwise
                       key on the proxy address (§49)
CORS_ORIGIN            real frontend origin(s), comma-separated; production
                       validation rejects localhost and wildcards
all provider keys      Brevo and Razorpay are mandatory in production;
                       missing keys refuse to boot. FCM and Gemini degrade
                       with a warning instead
```

#### Render free-tier limitations to document and accept

``` text
sleeps after inactivity
    The instance is suspended when idle. Because the BullMQ workers live in
    the same process, delayed jobs (seat-hold expiry, refunds,
    notifications) do not run while it sleeps. They are NOT lost --- BullMQ
    stores them in Redis and the worker picks up overdue jobs on wake ---
    but they fire late. Seat holds therefore expire late on a sleeping demo
    instance. Verified locally: jobs queued while workers were down were
    processed once workers came back.

cold start
    First request after sleep is slow. Health checks and demo scripts must
    tolerate it.

single instance
    No horizontal scaling on the free tier. The Socket.IO Redis adapter
    (§67) is already wired and stays correct, it is simply not exercised.

no persistent disk
    Already fine: uploads go to Cloudinary, nothing is written locally.
```

### Supabase PostgreSQL + PostGIS

``` text
PostGIS            required. The init migration already runs
                   CREATE EXTENSION IF NOT EXISTS "postgis", and the schema
                   declares extensions = [postgis]. Confirm this succeeds on
                   Supabase, which pre-installs PostGIS into its own
                   extensions schema --- the extension may already exist, and
                   the search_path may need checking so geography types and
                   ST_* functions resolve.
migrations         npm run db:migrate:deploy (prisma migrate deploy)
                   Migrations need a DIRECT connection, not the pooler.
SSL                Supabase requires TLS; the connection string must carry
                   the appropriate sslmode.
pooling            Supabase offers a direct port and a Supavisor pooled port.
                   SaathiRide uses the @prisma/adapter-pg driver adapter, so the
                   `pg` pool talks to whichever endpoint DATABASE_URL names.
                   Transaction-mode pooling disables prepared statements ---
                   verify the adapter's behavior against the pooled endpoint
                   before relying on it.
row locking        Booking concurrency depends on SELECT ... FOR UPDATE
                   inside a transaction (§35/§36). This is safe under
                   transaction pooling because a Prisma transaction is
                   pinned to one connection, but it must be re-verified on
                   the deployed database, not assumed.
geo queries        Ride search is raw SQL with ST_DWithin/ST_Distance and
                   depends on the two GiST indexes. Re-run EXPLAIN ANALYZE
                   against Supabase to confirm the planner still uses them.
connection limits  Free tier caps connections; the pool size must be set
                   accordingly rather than left at the default.
```

### Upstash Redis

Subject to the blocking decision above. If Upstash is retained:

``` text
protocol       must be the TCP/Redis-protocol endpoint, not the REST API ---
               ioredis and BullMQ both speak the Redis wire protocol
TLS            Upstash requires TLS (rediss://); ioredis must be given a URL
               that reflects that
ioredis        already the client everywhere (OTP, rate limiting, Socket.IO
               adapter, BullMQ)
BullMQ         requires blocking commands (BZPOPMIN/BRPOPLPUSH) and Lua
               (EVALSHA). Confirm the chosen plan supports all of them.
               maxRetriesPerRequest: null is already set on queue
               connections, as BullMQ requires
connections    each Worker holds its own connection (a Worker's blocking
               command monopolises its socket --- see the decision log (§18),
               2026-08-18). Current usage: 1 shared queue connection
               + 3 worker connections + 1 general client + 2 Socket.IO
               adapter clients = 7 concurrent connections minimum.
               Check this against the plan's connection cap.
OTP + limits   the general client carries commandTimeout, so a Redis stall
               fails fast rather than hanging (§97, 2026-08-17)
```

### External providers

All are already behind interfaces or config; deployment work is supplying
credentials, not code:

``` text
Cloudinary   CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET. Signed,
             authenticated delivery already in use.
Brevo        BREVO_API_KEY (an API key, xkeysib-…, not an SMTP key) and a
             verified BREVO_FROM_EMAIL. Mandatory in production.
             Free tier caps daily sends --- that cap is the OTP ceiling.
FCM          service-account credentials; FCM_CLIENT_EMAIL must be a
             …iam.gserviceaccount.com address or the app refuses it at boot.
Razorpay     PAYMENT_PROVIDER_KEY / SECRET mandatory in production;
             PAYMENT_PROVIDER_WEBHOOK_SECRET must match the webhook
             configured in the Razorpay dashboard, pointed at the deployed
             /api/v1/webhooks/payment URL.
Geoapify     MAP_PROVIDER_API_KEY. Free tier is credit-limited per day.
Gemini       GEMINI_API_KEY. Degrades to a console provider if absent.
```

### Docker

**Not required for this phase.** The original Phase 16 mandated a Dockerfile
because it targeted ECS Fargate, which can only run containers. Render
builds and runs a Node service directly from the repository using the build
and start commands above, so a Dockerfile would add an image to maintain
without changing what runs.

Containerization moves to the future AWS production scope (spec §65),
where it is genuinely required. If Render is ever configured to deploy from a Dockerfile
instead of its native Node runtime, this decision should be revisited.

### Success criteria

``` text
[ ] backend deployed and reachable over HTTPS on Render
[ ] connected to Supabase PostgreSQL
[ ] prisma migrate deploy applied cleanly
[ ] PostGIS extension present and ST_* queries working
[ ] GiST indexes confirmed in use via EXPLAIN ANALYZE
[ ] connected to Redis (provider per the blocking decision above)
[ ] OTP storage and rate limiting working
[ ] BullMQ queues and all three workers consuming
[ ] Socket.IO connecting over the deployed origin
[ ] external providers configured and reachable
[ ] GET /health returns 200
[ ] GET /ready returns 200 (and 503 when a dependency is down)
[ ] production environment validation passes (TRUST_PROXY, CORS, secrets)
[ ] core API smoke verification passes
```

### Status: complete (2026-08-16)

Deployed and reachable at `https://rydex-4efi.onrender.com`. The Redis blocking
decision resolved as option A: Upstash retained, with the idle command cost held
at roughly 6,900/day by `QUEUE_DRAIN_DELAY_SECONDS=300`.

What the deployment actually looks like, where it differs from the plan above:

``` text
Render        root directory `backend`, free instance, health check /health
Supabase      Supavisor SESSION pooler on port 5432, not the direct endpoint ---
              db.<ref>.supabase.co is IPv6-only and Render's free egress is
              IPv4. Session mode (not transaction mode) because a single
              DATABASE_URL serves both the app and `prisma migrate deploy`,
              and no DIRECT_URL is wired.
Upstash       rediss:// TCP endpoint; ioredis takes TLS from the scheme, so no
              code change was needed
migrations    run from a developer machine, not on Render. The free tier has no
              pre-deploy command, and prisma.config.ts imports config/env.ts ---
              so every Prisma CLI call validates all 81 vars and would trip the
              production assertions. Running locally with
              NODE_ENV=development sidesteps that.
```

Verified at deploy time: all 10 migrations applied, PostGIS 3.3 present,
`search_path` resolves `ST_*`, **both spatial GiST indexes survived the migration**
(the §22 hazard did not recur here), admin seeded, TLS 1.3 to Supabase, and
`GET /ready` returning 200 --- which exercises PostgreSQL and Redis together.

Not equivalent to production, and deliberately so: Razorpay runs in test mode, the
instance sleeps when idle, and the free tier keeps no log retention. See Phase 17
for what that costs.

------------------------------------------------------------------------

## Phase 17 — End-to-end verification of the deployment

Blocked on Phase 16. Verifies the complete passenger and driver journeys against
real deployed infrastructure rather than a local stack.


### Goal

Verify the **complete SaathiRide product end-to-end against the deployed
Render + Supabase + Upstash environment**.

This is deliberately not a repeat of Phase 15:

``` text
Phase 15   backend verification + hardening      (local, real stack)
Phase 16   deploy the backend and infrastructure
Phase 17   verify the whole product against what was deployed
```

Phase 15 proved the code is correct. Phase 17 proves the *deployment* is
correct --- managed Postgres, hosted Redis, a TLS-terminating proxy, real
provider webhooks reaching a public URL, and free-tier behavior are all
things that cannot be exercised locally.

### Business journey

Business rules below are the ones the code actually implements; they are
restated here, not changed.

#### Driver

``` text
Register
  ↓
Verify OTP
  ↓
Create profile
  ↓
Submit driving licence  ->  admin approval  ->  role becomes DRIVER
  ↓
Add vehicle
  ↓
Upload vehicle documents  ->  admin verification
  ↓
Create ride (eligibility = DRIVER + ownership + ACTIVE
             + vehicle VERIFIED + seat capacity)
  ↓
Pay 5% posting commission
  ↓
Ride becomes OPEN
```

Note the eligibility line: vehicle verification **does gate** ride creation.
An earlier draft of this phase said documents were "verification pending,
does not block" and listed eligibility without the VERIFIED requirement.
That was superseded by the decision log (§18) (2026-08-11) and §8/§96, and the
running code enforces it --- an unverified vehicle is rejected with
`409 VEHICLE_NOT_ELIGIBLE`. The text above matches the implementation.

#### Passenger

``` text
Register
  ↓
Verify OTP
  ↓
Search date + pickup + destination
  ↓
Receive rides within 10 km on both ends, on the requested
Asia/Kolkata calendar date
  ↓
Sort results (departure time / pickup distance / destination distance
              / fare / driver rating)
  ↓
Select ride
  ↓
Pay 10% prepayment
  ↓
Booking confirmed
```

#### Ride

``` text
Driver starts ride
  ↓
Passenger travels
  ↓
Driver completes ride
  ↓
Passenger pays remaining 90%
  ↓
3% platform commission
  ↓
97% driver settlement
```

Ratings close the journey (§18): once the ride is `COMPLETED`, the passenger
rates the driver and the driver rates the passenger, each once per booking. The
deployed verification should confirm the two aggregates move independently —
a driver's `driver_rating_average` must not be affected by how they were rated
as a passenger — and that a rated driver's next ride prices inside the ±5% band
the fare multiplier allows.

#### Cancellation

``` text
passenger cancellation      10% prepayment retained; rejected once the
                            ride has STARTED
driver early cancellation   >= 18h before departure: 2/5 of the captured
                            posting commission refunded
driver late cancellation    < 18h: posting commission retained
refund                      passenger prepayment refunded in full when the
                            driver cancels
notification                affected passengers notified
seat release                seats restored, bookings cancelled
payment state               refund intents recorded, resolved by the
                            refund worker
```

### Deployed infrastructure verification

#### Render

``` text
[ ] API reachable over HTTPS
[ ] GET /health and GET /ready
[ ] environment configuration correct in the Render dashboard
[ ] TRUST_PROXY=true actually yields real client IPs (per-IP rate limits
    must not all collapse onto the proxy address)
[ ] CORS accepts the real frontend origin and rejects others
[ ] rate limiting behaves as it did locally
[ ] Socket.IO connects and survives through the proxy
[ ] graceful restart: a redeploy drains cleanly and jobs are not lost
[ ] cold-start behavior after sleep is understood and tolerable
```

#### Supabase

``` text
[ ] Prisma connects over TLS
[ ] migrations applied (prisma migrate deploy)
[ ] PostGIS extension present
[ ] geographic ride search returns correct results
[ ] GiST indexes used (EXPLAIN ANALYZE on the deployed database)
[ ] transactions and SELECT ... FOR UPDATE row locking work through the
    connection pooler
[ ] data persists across an application restart
[ ] connection pool sized within the free-tier cap
```

#### Redis (Upstash, or the alternative chosen in §20 above)

``` text
[ ] connectivity over TLS
[ ] OTP storage and expiry
[ ] rate limiting, including window reset
[ ] refresh-token flows unaffected (tokens live in PostgreSQL, but the
    surrounding rate limits do not)
[ ] BullMQ queues and all three workers consuming
[ ] delayed jobs (seat-hold expiry) fire --- accounting for instance sleep
[ ] TTL behavior correct
[ ] command volume within plan limits (see the §20 blocking decision)
```

#### External integrations

``` text
[ ] email      real OTP delivered to a real inbox
[ ] uploads    Cloudinary upload + signed authenticated retrieval
[ ] maps       Geoapify routing from the deployed egress IP
[ ] payments   Razorpay webhook reaches the PUBLIC /api/v1/webhooks/payment
               URL with a valid signature --- this is the single most
               important thing that cannot be tested locally
[ ] push       FCM delivery to a real device token
[ ] AI support Gemini reachable, tool calling works, ownership boundary
               still enforced
```

### Final deployed end-to-end flow

``` text
                 RENDER
                   |
                   v
              SaathiRide Backend
              /           \
             v             v
        Supabase        Upstash
             \             /
              \           /
               v         v
             Business Logic
                    |
          +---------+---------+
          |                   |
        Driver             Passenger
          |                   |
          +-------- Ride -----+
                    |
                 Payment
                    |
                Completion
                    |
              Settlement
```

Plus, against the deployed environment:

``` text
Passenger <-> Driver chat   (Socket.IO through the Render proxy)
User -> AI support          (tool calling, ownership boundary)
```

### Success criteria

``` text
[ ] deployed backend reachable
[ ] authentication works
[ ] driver flow works
[ ] passenger flow works
[ ] ride flow works
[ ] booking works
[ ] payment flow works, including a real provider webhook
[ ] cancellation and refund work
[ ] notifications work
[ ] chat works
[ ] AI support works
[ ] PostgreSQL + PostGIS work
[ ] Redis works
[ ] BullMQ works
[ ] rate limiting works
[ ] CORS works
[ ] WebSocket works
[ ] external integrations work where applicable
[ ] no critical regression versus local Phase 15 verification
```

### Status: in progress (started 2026-08-16)

Unblocked by Phase 16. **Infrastructure is verified; no business journey has been
run yet**, so the checklists above stand with only the infrastructure items
closed. Nothing here was tested by a suite --- verification means driving the
deployed application by hand (§14), and the wording below says which.

**Verified against the deployment:**

``` text
Render      HTTPS reachable; GET /health 200; GET /ready 200 (proves PostgreSQL
            and Redis together); CORS accepts the configured origin and emits no
            Access-Control-Allow-Origin for others; Socket.IO handshake succeeds
            through the proxy and advertises the websocket upgrade; helmet CSP +
            HSTS present and x-powered-by absent; auth gate returns the documented
            401 envelope with a requestId
Supabase    TLS 1.3 (TLS_AES_256_GCM_SHA384, CN *.pooler.supabase.com); all 10
            migrations applied; PostGIS 3.3; search_path resolves ST_*; both
            rides_origin_gist and rides_destination_gist present; admin seeded
Upstash     reachable (via /ready); rate-limit counters increment and expose
            RateLimit-Limit/Remaining/Reset
```

**One HIGH-severity defect found and fixed** --- `TRUST_PROXY=true` did not yield
real client IPs but *client-supplied* ones, making every per-IP rate limit
bypassable. Full account in the §19 entry for this date; closed and re-verified on
the deployment.

**Open, and honestly open rather than quietly ticked:**

``` text
GiST index USE       blocked, not passed. The indexes exist, but `rides` holds 0
                     rows, so the planner correctly prefers the btree on
                     (departure_time, status) and applies ST_DWithin as a filter.
                     Provable only once representative data exists.
TLS verification     encrypted but NOT certificate-verified: sslmode=require is
                     libpq's encrypt-without-validating mode. verify-full plus
                     Supabase's CA would close it.
FCM push             not verifiable --- no client application exists to obtain a
                     device token. Recorded as N/A rather than untested.
every journey        driver, passenger, ride, booking, payment webhook,
                     cancellation, refund, ratings, chat and AI support all
                     remain unrun against the deployment.
```

The remaining work is the journeys, and the payment webhook is the item that
carries the most information --- it is the only part of the system that cannot be
exercised locally at all.

------------------------------------------------------------------------

---

# 21. Known gaps and deliberate exclusions

Everything below is **out of scope** — excluded by decision, not left undone.
Listed with the reasoning so the absence reads as a choice rather than an
oversight.

The only forward-looking work is Phase 16 (deployment) and Phase 17 (verifying
it), both in §20. There is no third category: nothing here is "planned but not
yet started".

``` text
automated tests · structured logging · metrics and tracing · OpenAPI
DigiLocker verification · SOS · live tracking
wallet · coupons · support tickets · blocked users · audit log · monthly passes
```

## Automated test infrastructure

Phase 15 was completed by manual/runtime verification (§19). A persistent
automated suite --- unit, integration, API, concurrency, failure-injection ---
remains future technical hardening, and is what would protect the verified
behavior against future regressions.

## Structured logging and OpenAPI

The codebase logs through `console.*` and has no generated API specification.
Both were noted as outstanding in earlier phases and remain so.

## AWS production infrastructure

ECS Fargate, RDS PostgreSQL + PostGIS, ElastiCache Redis and a load balancer
would be the production target if one were ever pursued. The current milestone
deploys to Render + Supabase + Upstash instead, and containerization belongs
with AWS — which is why Phase 16 needs no Dockerfile.

## DigiLocker document verification

```
status   out of scope --- not implemented, not planned
```

Today an admin opens a signed Cloudinary URL and looks at a JPEG. That works,
but it authenticates nothing — a convincing forgery passes — and it does not
scale past a reviewer's attention span.

DigiLocker is India's issuer-backed document wallet: a driving licence or RC
pulled through it comes from the issuing authority, so authenticity is a matter
of provenance rather than inspection.

The useful property is how little would change. It fits the existing provider
pattern as a new capability interface alongside `MapProvider` / `PaymentProvider`
— the domain would depend on the interface, not on DigiLocker's API. Both
verification state machines stay exactly as they are, and so do the decision
fields (`verifiedBy`, `verifiedAt`, `rejectionReason`) — they would simply
record an automated verifier instead of an admin user id. Manual review remains
the fallback for anything DigiLocker cannot supply, so the admin module is
augmented rather than replaced.

Open questions: DigiLocker requires organisational onboarding and OAuth-style
user consent, which is a product/legal step before it is an engineering one; and
consent tokens are user-scoped and expiring, so the flow is
"user authorises → we fetch → we verify", not a background job.

## SOS and live ride tracking

```
status   out of scope --- not implemented, not planned
```

Nothing currently knows where a ride is once it starts. `STARTED` and
`COMPLETED` are the only signals, both driver-triggered.

This is the largest item on this list, and the only one that does not fit the
current architecture as-is. Everything built so far is **read-heavy and
index-optimised** — ride search is one bounded PostGIS query per request. A
location stream is the opposite workload: small, constant, high-frequency writes
per active ride, with almost no read traffic until someone opens a map or an
incident occurs.

Consequences worth thinking through before building it:

- **Storage is the open decision.** Routing position updates through the same
  PostgreSQL primary that serves seat reservations and payment transitions would
  make a background stream contend with the operations that must stay fast. A
  partitioned table with a short retention window, a separate store, or a
  time-series database are all plausible; PostGIS's `geography` type is already
  the right shape for the data.
- **Ingestion already exists.** Socket.IO plus the Redis adapter is the transport
  the app already runs, so this does not need new infrastructure to receive
  positions — only to persist them.
- **SOS is a smaller problem than tracking.** It needs emergency contacts on the
  user, a trigger endpoint, and a delivery path — and the notification pipeline
  (BullMQ → FCM, with persistence separate from delivery) already provides the
  last of those. The one deliberate exception it would need is bypassing the
  normal rate limits, since an SOS is exactly the request that must never be
  throttled.
- **Retention is a privacy decision, not a technical one.** Continuous location
  history for every ride is sensitive data; how long it is kept, and who can read
  it, should be settled before the first row is written rather than after.

------------------------------------------------------------------------

## If the exclusions were ever revisited

Not a roadmap — none of this is scheduled. Recorded only so that a future
decision to take any of it on starts from the right ordering rather than from
scratch. Ordered by value per unit of effort:

1. **CI** — typecheck, lint and build on every push. The cheapest guard
   available, and nothing exists today.
2. **A CI check asserting both spatial indexes exist.** The Prisma migration
   hazard has now recurred three times and is mitigated only by a process rule,
   which is exactly the kind of thing a machine should enforce instead.
3. **Automated tests, in dependency order.** Unit tests for the pure functions
   first (fare, commission, cancellation policy, settlement, cursor
   encode/decode) — highest value per effort. Then integration tests for the
   concurrency scenarios against a real PostgreSQL: seat allocation, webhook
   idempotency, refresh-token reuse and the rating aggregate are the behaviours
   most expensive to re-verify by hand and most costly to regress. Then API
   tests.
4. **Structured logging** (pino with a request-scoped child logger — every call
   site already carries the correlation id), then **metrics and alerting**.
5. **OpenAPI generation** from the existing Zod schemas, which are already the
   source of truth for request shapes.
6. **Splitting the workers out of the API process** — the single most valuable
   structural change, and the only migration item that needs code.
7. **Payment reconciliation**, closing the "webhook never arrived" gap — which
   is also what would let rating eligibility tighten from the ride to the
   booking.

---

# 22. Migration procedure

One process rule that has to survive, because breaking it silently degrades ride
search to a sequential scan.

`rides.origin` and `rides.destination` are `Unsupported("geography(Point,4326)")`,
so Prisma's diff engine has no record that their GiST indexes exist and will emit
`DROP INDEX` for both on any migration touching `rides` — even one unrelated to
geography. This has happened twice, and once left both indexes actually missing.

For as long as those columns are `Unsupported`:

```bash
npx prisma migrate dev --create-only     # always --create-only
# read the generated SQL
# delete any DROP INDEX for rides_origin_gist / rides_destination_gist
npx prisma migrate dev                   # then apply
```

Use `CREATE INDEX IF NOT EXISTS` when re-adding them, so a fresh-database replay
does not collide with the original migration, and re-confirm with
`EXPLAIN ANALYZE`. Never edit an applied migration in place without also
correcting its stored checksum.
