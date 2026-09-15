# SaathiRide — Engineering Context

Working notes for anyone (including an AI assistant) changing this codebase:
the conventions in use, the invariants that must hold, and the traps that have
already caught someone once.

This file is deliberately short. It does not explain how SaathiRide works — that is
[`docs/architecture.md`](./architecture.md).

| Document | Answers |
|---|---|
| [`README.md`](../README.md) | What is SaathiRide, and how do I run it? |
| [`docs/architecture.md`](./architecture.md) | How is SaathiRide designed? |
| [`steps.md`](./steps.md) | How was it built, what was learned, what's next? |
| **`claude.md`** | What must I keep in mind while changing it? |

---

## 1. Project state

```
Phases 0–15   complete, manual runtime-verified.
Phase 16      complete — deployed on Render + Supabase + Upstash
Phase 17      in progress — infrastructure verified, journeys not yet
```

Live at `https://rydex-4efi.onrender.com`. It is a **free-tier portfolio
deployment, not a production stack** — Razorpay is in test mode, the instance
sleeps when idle (so BullMQ delayed jobs, including seat-hold expiry, fire late on
wake), and there is no log retention.

Two things to keep in mind when changing anything that touches them:

- **`trust proxy` is a hop count, never `true`.** `true` trusts every hop and
  makes `req.ip` the leftmost, client-supplied `X-Forwarded-For` entry, which made
  every per-IP rate limit bypassable in the deployed environment. It must equal
  the number of proxies that actually append to the header — 1 behind Render.
- **The money-failure paths end in `console.error`.** With no log retention or
  alerting, a final payment that fails, or one that succeeds against a booking
  that has moved on, is invisible in practice. Don't treat those branches as
  handled just because they are written.

Implemented: OTP auth with token rotation · user profiles and driver-licence
applications · vehicles and documents · admin verification · map provider and
fare engine · ride creation, lifecycle and PostGIS search · booking with seat
concurrency · payments, idempotency and webhooks · cancellation, refunds and
settlement · notifications · driver–passenger chat · AI support chatbot ·
bidirectional ratings · rate limiting across every endpoint category.


**Deliberately out of scope** — automated tests · structured logging ·
metrics and tracing · OpenAPI · DigiLocker document verification · SOS · live
ride tracking · wallet · coupons · support tickets · blocked users · audit log ·
monthly passes.

The only forward-looking work is finishing Phase 17 — driving the business
journeys against the deployment. The payment webhook is the part that matters
most: it is the one thing that cannot be exercised locally at all.

---

## 2. Domain rules

Three roles on one `users` table. Every signup is a `PASSENGER`; only an admin
approving a driving licence makes someone a `DRIVER` — there is no self-serve
upgrade. `ADMIN` is provisioned directly and authenticates through the same OTP
flow.

Each business rule lives in exactly one function. **Never re-derive a formula
somewhere else.**

| Rule | Where | Value |
|---|---|---|
| Posting commission | `commissionService` | 5% of `farePerSeat × totalSeats` |
| Passenger prepayment | `bookingService` | 10% of `totalFare` |
| Remaining fare | `settlementService` | `totalFare − prepaidAmount` |
| Platform commission | `settlementService` | 3%; driver gets 97% |
| Driver cancel refund | `cancellationPolicyService` | ≥18 h before departure: `2/5` of the commission. Later: nothing |
| Fare | `fareService` → `HeuristicFareStrategy` | `(base + km×rate) × vehicle × traffic × rating`, all multipliers bounded |
| Ride eligibility | `vehicleEligibilityService` | owner **+** `ACTIVE` **+** `VERIFIED` **+** seat capacity |
| Rating aggregate | `ratingRepository.applyToAggregate` | One atomic `UPDATE` folding a score into the ratee's running average — never read-modify-write |

Rules that look changeable but are not:

- **A vehicle must be admin-`VERIFIED` before it can be used to create a ride.**
  This reversed an earlier decision; do not relax it back.
- **The passenger prepayment is non-refundable** unless the *driver* cancels.
- **`retained` is derived as `commission − refund`**, never computed
  independently — that keeps the two summing exactly.
- **Fare is locked at creation** and copied onto the booking. Nothing
  recalculates historical fare from current config.
- **Reputation is role-scoped.** `driver_rating_*` and `passenger_rating_*` are
  separate pairs; the fare multiplier and the `DRIVER_RATING` sort read the
  driver pair only. Never blend them — a good passenger is not a good driver.
- **Ratings are immutable and one-per-participant-per-booking.** A repeat
  submission is *rejected* (`409 ALREADY_RATED`), never replayed like a payment
  idempotency key — a rating is an opinion, not a retryable side effect. The
  `(booking_id, rater_id)` unique constraint is what enforces it.
- **Who is being rated is derived, never sent.** The direction comes from the
  booking plus `req.user.id`; the request body carries only a score and comment.
- All percentages, radii and thresholds come from env. Never hard-code them.

---

## 3. Layering

```
routes → controllers → services → repositories
```

- Controllers parse, call one service, format a response. No SQL, no SDK calls,
  no logic. They currently run 13–48 lines; keep them there.
- Services own business rules, ownership checks, and transaction boundaries.
- Repositories own persistence only — no business rules.
- Cross-module calls are **service-to-service**. Never reach into another
  module's repository.
- `infrastructure/` never imports from `modules/`.
- No business logic in middleware.

`shared/` holds exactly two things (`AppError`, `sendSuccess`). Don't grow it
into a grab-bag — module-specific code stays in its module.

---

## 4. Transactions

**`BEGIN … COMMIT` contains only database statements.**

```
external call  →  BEGIN … internal writes … COMMIT  →  enqueue async work
```

An HTTP call inside a transaction holds row locks for network latency, exhausts
the pool, and — worst — a rollback cannot un-charge a card, so the transaction
would be lying about atomicity.

Transactions are short. Only services open them; repositories accept a
`Prisma.TransactionClient` so a service can compose atomic multi-repository work.

**Never throw inside a Prisma interactive transaction if writes made in it must
survive** — the throw rolls them back. Return a result variant and throw after
it commits. (`rotateRefreshToken` depends on this.)

---

## 5. Concurrency

Four mechanisms. Do not add a fifth — no in-process mutex, no advisory lock, no
Redis lock; all three break under multiple instances.

**1. Conditional UPDATE** — the workhorse:

```ts
const result = await db.<model>.updateMany({
  where: { id, status: { in: ALLOWED_SOURCE_STATES } },
  data:  { status: NEW_STATE },
});
return result.count === 1;   // false ⇒ someone else already moved it
```

The guard is evaluated under the lock the `UPDATE` itself takes, so check and
write cannot separate. **Callers branch on the boolean, never on a prior read.**

Seat allocation is the same idea in raw SQL — the `WHERE` carries
`available_seats >= $n`, so seats can never go negative and `OPEN ⇄ FULL` flips
inside the same statement.

**2. Unique constraint as arbiter** — the database picks the winner
(`idempotency_keys (user_id, key)`, `conversations (ride_id, passenger_id)`).

**3. Transaction scoping.** **4. `jobId`** for queue dedupe.

Invariants that must always hold:

```
seats are never oversold
a payment is never confirmed twice
a refund never exceeds the refundable amount
a reused refresh token revokes the whole family
concurrent transitions produce exactly one winner
every job handler is safe to re-run
historical fare never changes because config changed
```

Never protect any of these with a frontend check, a Redis counter, or a
read-then-write.

---

## 6. Database

PostgreSQL is authoritative for everything durable. Redis is authoritative for
nothing.

- UUID keys · `Decimal(10,2)` for money · `Timestamptz(3)` for time.
- `snake_case` columns, `camelCase` in TypeScript, via `@map`/`@@map`.
- One `status` column per lifecycle — never split into `booking_status` +
  `payment_status`.
- Uniqueness belongs in the database, not in an application check that races.
- No binaries in Postgres; documents live in Cloudinary.
- No soft deletion — entities reach terminal statuses. (`UserDevice` is the one
  exception: dead FCM tokens are removed.)
- Add indexes from real query patterns, verified with `EXPLAIN ANALYZE`.

These constraints are load-bearing — application code relies on the database
arbitrating the race. Don't drop them:

```
idempotency_keys (user_id, key) · conversations (ride_id, passenger_id)
payments.provider_order_id · user_devices.device_token
users.email · users.phone · vehicles.registration_number · refresh_tokens.token_hash
```

---

## 7. Auth and authorization

- No passwords anywhere. OTPs are bcrypt-hashed before Redis and never logged.
- Access tokens: 15 min, HS256, claims `{ sub, role, type }`. Verify the `type`
  claim at runtime — a claim that is only cast is not checked.
- Refresh tokens are **not JWTs**: random bytes, stored as a SHA-256 hash,
  rotated on every use, family revoked on reuse.
- Refresh re-reads the role from the database. That is how a `PASSENGER →
  DRIVER` promotion propagates — no other mechanism needed.
- Suspension is checked when a session is *granted* (OTP verify, refresh), never
  in `authenticate`. A per-request database read would defeat stateless tokens.
- Never check suspension on `request-otp` — it would confirm the account exists.

Authorization has two layers. **Role gates** (`authorize`) only where a whole
capability is role-scoped: `POST /rides`, `POST /vehicles`, all of `/admin`.
**Ownership checks in services** everywhere else:

```ts
if (!resource || resource.ownerId !== userId) {
  throw new AppError(404, 'X_NOT_FOUND', '…');   // 404, never 403
}
```

Always 404 for "exists but isn't yours" — 403 lets an attacker probe for valid
ids.

> **The IDOR rule:** the authenticated user id always comes from `req.user.id` —
> never from the body, query, path, or a model's tool arguments.

Never trust a client-supplied `userId`, `role`, `fare`, `commission`,
`paymentStatus`, `rideStatus`, `availableSeats`, or `driverId`.

Chat participation is re-checked on **every** `send_message`, not only on join —
a client can send without ever joining.

---

## 8. Redis

Ephemeral state only: **OTPs · rate-limit counters · BullMQ · Socket.IO
backplane.** That is the complete list. There is deliberately no application
cache and no Redis seat counter — a second authority on seat allocation is a
correctness bug waiting to happen.

The fail modes are asymmetric **on purpose**, on the same connection: rate
limiting fails **open** (an outage must not take down the API), OTP storage
fails **closed** (there is no safe way to accept a login code without the
store). Don't "fix" the inconsistency.

- Keep `commandTimeout` on the shared client. Without it, ioredis buffers
  commands during an outage and requests *hang* rather than fail — and no
  `try/catch` rescues a hang.
- Don't disable `enableOfflineQueue` globally; it also breaks normal reconnects.
- **Every BullMQ Worker needs its own connection.** Queues may share one.

---

## 9. Queues

Three queues, one per responsibility: `booking-expiry`, `refund`,
`notification`. Don't add a fourth without a genuinely distinct one.

- **Every handler must be idempotent** — retries, manual re-triggers and
  duplicate enqueues all have to be safe.
- **Generate deterministic ids in the producer, not the worker.** An id created
  in the worker differs on every retry and produces duplicate rows.
- Use `jobId` for natural dedupe.
- Retry budgets stay bounded — unlimited retry against a broken credential is an
  infinite loop that hides the problem.
- Never block a user-facing request on push delivery.
- Persist first (idempotently), then deliver and let it throw so the queue
  retries. A delivery failure must never prevent the in-app record existing.

---

## 10. Providers

Six interfaces: `MapProvider`, `PaymentProvider`, `EmailProvider`,
`PushProvider`, `AIProvider`, `DocumentProvider`. **The domain never imports a
vendor SDK.**

- Directories are named for the **capability, not the vendor** (`email/`, not
  `brevo/`). A vendor-named folder needs renaming on the next swap.
- Selection is a factory keyed off config, never a concrete class imported by a
  consumer.
- Take the vendor SDK where the protocol is easy to get subtly wrong (payment
  signatures, Firebase auth, LLM tool-calling); hand-roll a single HTTP call.
- When a vendor requirement leaks in, choose deliberately: a **named method** if
  the concept is universal (`verifyWebhookSignature`), an **opaque field** if it
  is not (`AIToolCall.providerState`).
- Fallbacks must never be quietly acceptable in production. Email and payment
  fallbacks are actively unsafe, so production boot refuses without their
  credentials; push and AI merely degrade, so they warn.

---

## 11. Security

- Validate body, query **and params** with Zod. Every `:id` route needs
  `validateParams` — ids are `@db.Uuid`, so an unvalidated one reaches the
  driver as a raw 500.
- Never expose database errors, stack traces or SQL to a client.
- Raw SQL uses `Prisma.sql` tagged templates. The only interpolated fragments
  are compile-time constants chosen by a `switch` on a validated enum. Never
  interpolate anything client-supplied.
- Verify webhook signatures over the exact raw bytes, before parsing or any
  state change. A frontend "payment succeeded" is never authoritative.
- Validate uploads by magic bytes, not the declared MIME type. Derive storage
  paths from authenticated state.
- Documents use authenticated Cloudinary delivery with per-read signed URLs.
  Never hand out a permanently-usable document link.
- **Never log** OTPs, tokens, payment secrets, document contents, API keys, or
  full device tokens. Map-provider URLs carry the API key — keep them out of
  errors.
- `TRUST_PROXY` defaults to `false`, which is correct without a proxy; production
  boot requires `true`. Flip it in the same change that adds a load balancer.
- Never commit secrets. Keep `.env.example` in sync with `config/env.ts`.

---

## 12. API conventions

```jsonc
{ "success": true,  "data": { } }
{ "success": true,  "data": { "items": [], "nextCursor": "…" } }
{ "success": false, "error": { "code": "STABLE_CODE", "message": "…" }, "requestId": "req_…" }
```

Error codes are stable and machine-readable — don't rename an existing one. 4xx
is answered quietly; 5xx is always logged with its `cause`. Anything
unrecognised becomes `500 INTERNAL_ERROR` with a generic message.

List endpoints use cursor pagination, never offset. Cursors are opaque, carry a
deterministic tie-breaker, and are rejected if replayed against a different sort
order. Everything lives under `/api/v1`.

---

## 13. Migrations

**The most dangerous recurring hazard here.** `rides.origin` and
`rides.destination` are `Unsupported("geography(Point,4326)")`, so Prisma has no
record that their GiST indexes exist and will emit `DROP INDEX` for both on any
migration touching `rides` — even one unrelated to geography. This has happened
twice; once both indexes were actually lost, silently degrading ride search to a
sequential scan.

```bash
npx prisma migrate dev --create-only     # always --create-only
# read the generated SQL
# delete any DROP INDEX for rides_origin_gist / rides_destination_gist
npx prisma migrate dev                   # then apply
```

Use `CREATE INDEX IF NOT EXISTS` when re-adding them, and re-check with
`EXPLAIN ANALYZE`. Never edit an applied migration without correcting its stored
checksum.

---

## 14. Working conventions

- TypeScript strict mode. Never weaken it to make code compile. Avoid `any`;
  prefer `unknown` with narrowing.
- `npm run typecheck`, `npm run lint` and `npm run build` all pass before
  anything is considered done.
- Match the surrounding code's comment density and idiom. Existing comments
  usually explain *why* something non-obvious is that way — read them before
  changing what they describe.
- Don't build abstractions with no current use.
- **Verification means driving the running application**, since no test suite
  exists. Say which was done — never call something "tested" when it was
  manually verified.
- If documentation contradicts the code, **the code is right and the document is
  a bug.** Fix the document.
- When an architectural decision genuinely changes, add a dated entry to
  `steps.md` §19 and update whatever it affects. Don't change a documented
  decision silently.

### Don't

Create microservices, Kubernetes config, or add Kafka · store OTPs, documents or
images in Postgres · use Redis as the source of truth for seats, bookings or
payments · call a map API per search result · trust frontend-reported payment
success, fare, seats or role · mutate booking/ride status from a controller ·
make external calls inside a transaction · put secrets in source · duplicate a
business rule · use offset pagination · expose raw database errors · claim tests,
structured logging, metrics or OpenAPI exist.

A deployment now *does* exist (§1), so describing it is accurate — but describe it
as what it is: a free-tier portfolio target whose business journeys are still
unverified. Don't call Phase 17 done, and don't call anything "tested" when it was
driven by hand.

---

## 15. Traps

Each of these was a real bug. The full accounts are in `steps.md` §19.

| Trap | Rule |
|---|---|
| Prisma drops the `rides` GiST indexes | Always `migrate dev --create-only`, strip the `DROP INDEX` lines (§13) |
| Workers sharing a Redis connection | A blocking `BZPOPMIN` monopolises its socket; after an outage one worker's loop never resumes — silently, still reporting `isRunning() === true` |
| ioredis buffers while disconnected | Without `commandTimeout` an outage hangs requests instead of failing them |
| `firebase-admin` `cert()` throws synchronously | Wrap provider construction — a malformed key once killed the whole process at import |
| Throwing inside a Prisma transaction | Rolls back its writes. Return a variant, throw after commit |
| `ST_MakePoint` takes longitude first | Reversed, every Indian ride lands in the Indian Ocean |
| `geography` vs `geometry` | `geometry` at SRID 4326 returns degrees, not metres |
| Express 5 `req.query` is getter-only | Validated query goes on `req.validatedQuery` |
| `z.coerce.boolean()` makes `"false"` true | Security booleans use `z.enum(['true','false'])` |
| Gemini rejects a replayed `functionCall` | Persist and replay `providerState` verbatim; never interpret it |
| Gemini rejects a non-object `functionResponse` | Wrap arrays before sending |
| Raw DTOs sent to an LLM | `getRide` whole ships ~10 KB of route geometry plus the driver's commission — project tool results |
| A provider SDK resolving with an error instead of throwing | Exactly how every OTP email failure was swallowed while returning 200 |
| `FCM_CLIENT_EMAIL` must be a service account | A personal Google address constructs fine, then fails every send |
| Tool-round budget needs one extra completion | On exhaustion, complete once with tools withheld rather than erroring |
| Socket.IO CORS needs the parsed origin array | The raw comma-separated string emits an illegal header and breaks every origin |
