import { prisma } from '../../../infrastructure/database/prismaClient';
import type { TransactionType } from '../../../generated/prisma/enums';

// Takes a client so the service can run both inserts in the SAME transaction
// as whatever ride/booking write they record — the shape every other
// repository in this codebase already follows (bookingRepository.create,
// rideRepository.reserveSeats). Payment and Transaction rows are never
// written outside paymentRecordService.recordOrder, so this type only ever
// needs the two models it touches.
type Client = Pick<typeof prisma, 'payment' | 'transaction'>;

export interface CreatePaymentData {
  rideId: string | null;
  bookingId: string | null;
  provider: string;
  providerOrderId: string;
  amount: number;
}

export interface PaymentRecord {
  id: string;
  rideId: string | null;
  bookingId: string | null;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amount: number;
  status: 'CREATED' | 'SUCCESS' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}

const PAYMENT_SELECT = {
  id: true,
  rideId: true,
  bookingId: true,
  provider: true,
  providerOrderId: true,
  providerPaymentId: true,
  amount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPaymentRecord(row: {
  id: string;
  rideId: string | null;
  bookingId: string | null;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amount: unknown;
  status: 'CREATED' | 'SUCCESS' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}): PaymentRecord {
  return { ...row, amount: Number(row.amount) };
}

// A gateway attempt always starts CREATED (the column default) — neither is a
// caller's choice. `provider` is the name of whichever PaymentProvider
// actually created the order (infrastructure/payments' providerName), never
// hardcoded here, so historical rows stay accurate if the active provider
// ever changes.
export async function createPayment(
  client: Client,
  data: CreatePaymentData,
): Promise<PaymentRecord> {
  const payment = await client.payment.create({ data, select: PAYMENT_SELECT });
  return toPaymentRecord(payment);
}

export interface CreateTransactionData {
  paymentId: string;
  rideId: string | null;
  bookingId: string | null;
  type: TransactionType;
  amount: number;
}

export interface TransactionRecord {
  id: string;
  paymentId: string;
  rideId: string | null;
  bookingId: string | null;
  type: TransactionType;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}

const TRANSACTION_SELECT = {
  id: true,
  paymentId: true,
  rideId: true,
  bookingId: true,
  type: true,
  amount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toTransactionRecord(row: {
  id: string;
  paymentId: string;
  rideId: string | null;
  bookingId: string | null;
  type: TransactionType;
  amount: unknown;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
}): TransactionRecord {
  return { ...row, amount: Number(row.amount) };
}

// A business record always starts PENDING (the column default) — resolved
// below by the webhook.
export async function createTransaction(
  client: Client,
  data: CreateTransactionData,
): Promise<TransactionRecord> {
  const transaction = await client.transaction.create({ data, select: TRANSACTION_SELECT });
  return toTransactionRecord(transaction);
}

// The webhook's lookup key (architecture.md §11: "payments.provider_order_id
// is UNIQUE, so lookup is unambiguous"). A plain read — the conditional
// UPDATE below is what actually decides whether this call gets to resolve
// the row; this only tells the caller whether one exists at all, and if so,
// whether it is still CREATED.
export async function findByProviderOrderId(
  client: Client,
  providerOrderId: string,
): Promise<PaymentRecord | null> {
  const payment = await client.payment.findUnique({
    where: { providerOrderId },
    select: PAYMENT_SELECT,
  });
  return payment ? toPaymentRecord(payment) : null;
}

// Conditional UPDATE: resolves a Payment ONLY from CREATED (architecture.md
// §11's first layer of webhook idempotency). `count === 0` means a
// concurrent or duplicate delivery already resolved it first — nothing was
// overwritten, however many deliveries race.
export async function resolvePayment(
  client: Client,
  providerOrderId: string,
  status: 'SUCCESS' | 'FAILED',
  providerPaymentId: string,
): Promise<boolean> {
  const result = await client.payment.updateMany({
    where: { providerOrderId, status: 'CREATED' },
    data: { status, providerPaymentId },
  });
  return result.count === 1;
}

// The Transaction's own conditional UPDATE — architecture.md §11's third
// layer ("every downstream entity transition is itself a conditional
// update"), applied here too even though the Payment's own guard above
// already arbitrated the race: defense in depth, not a second arbiter.
export async function resolveTransaction(
  client: Client,
  paymentId: string,
  status: 'SUCCESS' | 'FAILED',
): Promise<boolean> {
  const result = await client.transaction.updateMany({
    where: { paymentId, status: 'PENDING' },
    data: { status },
  });
  return result.count === 1;
}

// The driver-cancellation cascade's lookup for "was the posting commission
// actually captured?" — a refund is only ever owed against money that
// genuinely moved. A plain read: whether a refund is then created is the
// cascade's own policy decision (cancellationPolicyService), not this
// repository's.
export async function findSuccessfulByRideId(
  client: Client,
  rideId: string,
): Promise<PaymentRecord | null> {
  const payment = await client.payment.findFirst({
    where: { rideId, status: 'SUCCESS' },
    select: PAYMENT_SELECT,
  });
  return payment ? toPaymentRecord(payment) : null;
}

// The cascade's per-booking counterpart: a CONFIRMED booking's prepayment
// was necessarily captured (that is what CONFIRMED means), so this exists
// to find the specific Payment row to refund against, not to ask whether
// one exists.
export async function findSuccessfulByBookingId(
  client: Client,
  bookingId: string,
): Promise<PaymentRecord | null> {
  const payment = await client.payment.findFirst({
    where: { bookingId, status: 'SUCCESS' },
    select: PAYMENT_SELECT,
  });
  return payment ? toPaymentRecord(payment) : null;
}
