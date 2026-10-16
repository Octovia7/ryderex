# Ryderex

**Ryderex** (formerly *SaathiRide*) is a full-stack, India-focused carpooling platform that matches drivers and passengers for intercity trips. Drivers post a ride they're already taking and sell the empty seats; passengers search by route and book one. The platform handles everything around that trip — geospatial matching, two-stage payments, real-time chat, document-verified driver onboarding, and an AI support assistant.

This repository contains the **backend API** (Node.js/Express/TypeScript) and the **frontend web app** (React/TypeScript), built as a modular monolith with a clear module boundary per domain.

- **Live app:** [ryderex.vercel.app](https://ryderex.vercel.app)
- **API:** [ryderex.onrender.com](https://ryderex.onrender.com)

---

## Features

**Passengers**
- Passwordless, OTP-based sign-in (email)
- Geospatial ride search — radius-based pickup/drop matching, five sort strategies (departure time, pickup distance, drop distance, fare, driver rating)
- Seat booking with a two-stage payment: a 10% prepayment holds the seat, the remaining 90% is charged on trip completion
- Real-time map of the actual route (Leaflet, using the real road-following geometry the ride was priced against — not a straight line)
- In-app chat with the driver, and ratings after a completed trip
- "Confirm pickup" — an auditable, passenger-set record of whether they actually got in the car, surfaced to the driver before they start

**Drivers**
- Post a ride; fare and a 5% posting commission are computed server-side from the real route distance, vehicle type, and traffic/rating multipliers — never trusted from the client
- Manage posted rides: start, complete, cancel; see confirmed passengers per ride
- Vehicle registration with document upload (RC, insurance, pollution certificate), each independently reviewable
- Driver licence application, reviewed by an admin before driver access activates

**Admin**
- Review queue for pending driver licences and vehicle documents, with verify/reject + a required rejection reason

**Platform-wide**
- Real-time driver↔passenger chat (Socket.IO)
- An AI support chatbot (Gemini, with tool-calling into a user's own bookings/rides) for self-serve help
- Push/in-app notifications for booking, payment, and ride-lifecycle events
- Idempotency keys on every money-creating request, so a retried network call can never double-charge or double-book

---

## Tech stack

**Backend**
| | |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | Express 5 |
| Database | PostgreSQL + PostGIS (geospatial queries), via Prisma ORM |
| Cache / Jobs | Redis, BullMQ (booking expiry, notifications, refunds) |
| Realtime | Socket.IO (chat), with a Redis adapter for multi-instance delivery |
| Payments | Razorpay, webhook-verified (the client's own checkout callback is never trusted as proof of payment) |
| AI | Google Gemini (`@google/genai`), function/tool-calling |
| Maps | Geoapify (geocoding, routing, distance) |
| Email | Brevo (OTP delivery) |
| File storage | Cloudinary (driver/vehicle documents, time-boxed signed URLs) |
| Push | Firebase Cloud Messaging |

**Frontend**
| | |
|---|---|
| Framework | React 18, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| Routing | React Router |
| Realtime | socket.io-client |
| Maps | Leaflet |
| Icons | lucide-react |

**Infrastructure (production)**
- API: [Render](https://render.com)
- Frontend: [Vercel](https://vercel.com)
- Database: [Supabase](https://supabase.com) (PostgreSQL + PostGIS)

---

## Architecture notes

A few decisions worth calling out, documented in full in [`docs/architecture.md`](docs/architecture.md):

- **Payments are never client-authoritative.** Checkout.js's success callback only triggers a re-check against the backend's own state; the *only* thing that actually confirms a payment is Razorpay's signature-verified webhook.
- **Every write that can be retried carries an idempotency key** (booking creation, ride posting), so a timed-out request that actually succeeded server-side is never double-applied on retry.
- **IDOR-safe by convention:** a resource that exists but isn't yours returns the same `404` as one that doesn't exist at all — never a `403` that would confirm its existence.
- **Keyset (cursor) pagination** everywhere a list can grow — never offset-based — so pages stay stable under concurrent writes.
- **Geospatial search** uses PostGIS `ST_DWithin`/`ST_Distance` against GiST-indexed `origin`/`destination` columns, not a full-table scan with Haversine math in application code.
- **Every external provider has a documented fallback** for local development (a console email/push/AI provider, a stub payment provider) so the app boots and runs without every third-party key configured — but production refuses to boot without the ones that have no safe fallback (database, Redis, payment/email secrets).

---

## Project structure

```
.
├── src/                        # Backend (Express + TypeScript)
│   ├── modules/                 # One folder per domain: auth, user, vehicle,
│   │                            # ride, booking, payment, chat, notification,
│   │                            # rating, support, admin — each with its own
│   │                            # controllers/services/repositories/schemas/routes
│   ├── infrastructure/          # Postgres, Redis, queues, sockets, email,
│   │                            # maps, payments, AI, file storage, health
│   ├── middleware/               # auth, role, validation, rate limiting, idempotency
│   ├── shared/                   # Cross-cutting error/response helpers
│   └── config/                   # Env parsing and validation (zod)
├── prisma/
│   ├── schema.prisma             # Data model
│   └── migrations/               # Versioned, reviewed SQL migrations
├── frontend/
│   └── src/
│       ├── routes/               # One screen per route
│       ├── components/           # Shared UI (incl. ui/ primitives: Button, Card, Dialog…)
│       ├── api/                  # Typed API client, one file per backend module
│       └── auth/                 # Session/role context
├── docs/
│   ├── architecture.md           # Canonical system design reference
│   ├── claude.md                 # Engineering conventions and invariants
│   └── steps.md                  # Build history / decision log
└── docker-compose.yml             # Local Postgres + Redis for development
```

---

## Getting started

### Prerequisites
- Node.js ≥ 20
- Docker (for local Postgres + Redis), or your own instances of each

### Backend

```bash
# Start local Postgres + Redis
docker compose up -d

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env

# Apply database migrations
npx prisma migrate deploy

# Run the API (http://localhost:4000)
npm run dev
```

Most third-party integrations (Razorpay, Brevo, Geoapify, Gemini, Cloudinary, FCM) are **optional for local development** — each falls back to a safe stub/console provider when unconfigured. See the comments in [`.env.example`](.env.example) for exactly which variables are required versus optional, and what each fallback does.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev   # http://localhost:5173
```

---

## API documentation

The full API surface, data model, and the reasoning behind every non-obvious design decision are documented in [`docs/architecture.md`](docs/architecture.md). Engineering conventions (error handling, validation, auth, rate limiting) are in [`docs/claude.md`](docs/claude.md).

## License

UNLICENSED — private project.
