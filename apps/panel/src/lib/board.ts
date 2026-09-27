import type { OrderDto, TicketDto } from '@prochia/shared';
import { formatTime, toFaDigits } from '@prochia/shared';

export type StationFilter = 'all' | string;

export function minutesSince(iso: string | null, now: number) {
  return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000)) : 0;
}

/** Colour band on the card edge: fine, getting slow, late. */
export function ageBand(minutes: number, prepMinutes = 12): 'ok' | 'warn' | 'late' {
  if (minutes >= prepMinutes * 2) return 'late';
  if (minutes >= prepMinutes) return 'warn';
  return 'ok';
}

export function ageLabel(minutes: number) {
  return minutes < 1 ? 'همین الان' : `${toFaDigits(minutes)} دقیقه`;
}

export function paymentLabel(o: OrderDto): {
  text: string;
  tone: 'green' | 'warning' | 'info' | 'danger' | undefined;
} {
  if (o.pendingPayment?.status === 'awaiting_review')
    return { text: 'کارت‌به‌کارت — بررسی نشده', tone: 'warning' };
  if (o.paymentState === 'paid') return { text: 'پرداخت شده', tone: 'green' };
  if (o.paymentState === 'postpaid') return { text: 'اعتباری VIP', tone: 'info' };
  if (o.paymentState === 'refunded') return { text: 'برگشت داده شد', tone: 'danger' };
  return { text: 'پرداخت در صندوق', tone: 'warning' };
}

export function scheduleLabel(o: OrderDto) {
  return o.scheduledFor ? `پیش‌سفارش ${formatTime(new Date(o.scheduledFor))}` : null;
}

export interface TicketCard {
  order: OrderDto;
  ticket: TicketDto;
}

/** Station tickets across the board's open orders, for the work columns. */
export function ticketsFor(
  orders: OrderDto[],
  station: StationFilter,
  statuses: TicketDto['status'][],
): TicketCard[] {
  const cards: TicketCard[] = [];
  for (const order of orders) {
    for (const ticket of order.tickets) {
      if (!statuses.includes(ticket.status)) continue;
      if (station !== 'all' && ticket.stationId !== station) continue;
      cards.push({ order, ticket });
    }
  }
  return cards;
}
