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
// later by the webhook, which does not exist yet (a later step).
export async function createTransaction(
  client: Client,
  data: CreateTransactionData,
): Promise<TransactionRecord> {
  const transaction = await client.transaction.create({ data, select: TRANSACTION_SELECT });
  return toTransactionRecord(transaction);
}
