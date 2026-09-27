import type { OrderDto } from '@prochia/shared';
import { ORDER_STATUS_LABELS, TICKET_STATUS_LABELS, formatTime } from '@prochia/shared';
import { Icon, Tag } from '@prochia/ui';

type StepState = 'done' | 'current' | 'todo';

const ticketTone = (s: string) =>
  s === 'ready' || s === 'served'
    ? 'green'
    : s === 'preparing'
      ? 'lime'
      : s === 'cancelled'
        ? 'danger'
        : undefined;

export function orderStatusTone(status: OrderDto['status']) {
  if (status === 'ready') return 'lime' as const;
  if (status === 'completed') return 'green' as const;
  if (status === 'rejected' || status === 'cancelled') return 'danger' as const;
  if (status === 'placed' || status === 'awaiting_payment') return 'warning' as const;
  return 'info' as const;
}

/**
 * The member-facing timeline. It mirrors how the kitchen actually works: the restaurant confirms
 * first, then every station (restaurant upstairs, café downstairs) prepares its part.
 */
export function OrderTimeline({ order }: { order: OrderDto }) {
  const s = order.status;
  const closed = s === 'rejected' || s === 'cancelled';
  const idx = ['placed', 'accepted', 'preparing', 'ready', 'completed'].indexOf(
    s === 'awaiting_payment' ? 'placed' : s,
  );
  const state = (i: number): StepState =>
    closed ? (i === 0 ? 'done' : 'todo') : i < idx ? 'done' : i === idx ? 'current' : 'todo';
  const acceptance = order.tickets.find((t) => t.isAcceptance);
  const activeTickets = order.tickets.filter((t) => t.status !== 'cancelled');

  const steps = [
    {
      title: s === 'awaiting_payment' ? 'در انتظار پرداخت' : 'ثبت شد',
      detail: formatTime(new Date(order.createdAt)),
    },
    {
      title: `تأیید ${acceptance?.stationName ?? 'رستوران'}`,
      detail: order.acceptedAt
        ? formatTime(new Date(order.acceptedAt))
        : 'موجودی مواد اولیه بررسی می‌شود',
    },
    { title: 'آماده‌سازی', detail: null },
    {
      title: order.type === 'dine_in' ? 'آماده؛ سر میز می‌آوریم' : 'آماده تحویل',
      detail: order.readyAt ? formatTime(new Date(order.readyAt)) : null,
    },
    {
      title: 'تحویل شد',
      detail: order.completedAt ? formatTime(new Date(order.completedAt)) : null,
    },
  ];

  return (
    <div className="timeline">
      {steps.map((step, i) => (
        <div key={i} className="timeline__step" data-state={state(i)}>
          <span className="timeline__dot">
            {state(i) === 'done' && <Icon name="check" size={14} strokeWidth={2.4} />}
          </span>
          <div>
            <div className="timeline__title">{step.title}</div>
            {step.detail && <div className="timeline__detail num">{step.detail}</div>}
            {i === 2 && idx >= 1 && !closed && (
              <div>
                {activeTickets.map((t) => (
                  <div key={t.id} className="station-status">
                    <span>
                      {t.stationName}
                      {t.floorLabel && <span className="faint"> · {t.floorLabel}</span>}
                    </span>
                    <Tag tone={ticketTone(t.status)}>
                      {t.status === 'scheduled' && t.dueAt
                        ? `شروع ساعت ${formatTime(new Date(t.dueAt))}`
                        : TICKET_STATUS_LABELS[t.status]}
                    </Tag>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      {closed && (
        <div className="notice notice--danger">
          <Icon name="alert" />
          <div>
            {ORDER_STATUS_LABELS[s]}
            {order.rejectReason && `: ${order.rejectReason}`}
          </div>
        </div>
      )}
    </div>
  );
}
