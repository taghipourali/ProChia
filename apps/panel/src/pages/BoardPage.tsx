import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto } from '@prochia/shared';
import { ORDER_STATUS_LABELS, formatTime, formatToman, toFaDigits } from '@prochia/shared';
import { Button, Segmented, Spinner, Tag, useToast } from '@prochia/ui';
import { Page } from '../components/kit';
import { OrderDrawer } from '../components/OrderDrawer';
import { ApiError, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  ageBand,
  ageLabel,
  minutesSince,
  paymentLabel,
  scheduleLabel,
  ticketsFor,
  type StationFilter,
  type TicketCard,
} from '../lib/board';

const STATION_KEY = 'prochia.panel.station';

export function BoardPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);

  const board = useQuery({
    queryKey: ['board'],
    queryFn: () => api<OrderDto[]>('/staff/board'),
    refetchInterval: 60_000,
  });
  const orders = board.data ?? [];

  // Stations come from the tickets themselves; the acceptance station (restaurant) first.
  const stations = useMemo(() => {
    const map = new Map<string, { id: string; label: string; isAcceptance: boolean }>();
    for (const o of orders)
      for (const t of o.tickets)
        map.set(t.stationId, {
          id: t.stationId,
          label: [t.stationName, t.floorLabel].filter(Boolean).join(' · '),
          isAcceptance: t.isAcceptance,
        });
    return [...map.values()].sort((a, b) => Number(b.isAcceptance) - Number(a.isAcceptance));
  }, [orders]);

  const role = auth.me?.staff.role;
  const [station, setStation] = useState<StationFilter>(() => {
    try {
      return localStorage.getItem(STATION_KEY) ?? 'all';
    } catch {
      return 'all';
    }
  });
  useEffect(() => {
    // Kitchen staff land on their own station the first time.
    if (station !== 'all' || !stations.length) return;
    if (role === 'restaurant') setStation(stations.find((s) => s.isAcceptance)?.id ?? 'all');
    if (role === 'cafe') setStation(stations.find((s) => !s.isAcceptance)?.id ?? 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, stations.length]);
  const pickStation = (s: StationFilter) => {
    setStation(s);
    try {
      localStorage.setItem(STATION_KEY, s);
    } catch {
      /* ignore */
    }
  };
  const selected = stations.find((s) => s.id === station);
  const isAcceptanceView = station === 'all' || selected?.isAcceptance;

  const refresh = () => void client.invalidateQueries({ queryKey: ['board'] });
  const accept = useMutation({
    mutationFn: (id: string) => api(`/staff/orders/${id}/accept`, { method: 'POST', body: {} }),
    onSuccess: refresh,
    onError: (e, id) => {
      toast(errorMessage(e), 'error');
      // Shortages need a decision; open the order to remove items or force.
      if (e instanceof ApiError && e.code === 'insufficient_stock') setOpenId(id);
    },
  });
  const ticketAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'ready' }) =>
      api(`/staff/tickets/${id}`, { method: 'POST', body: { action } }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const handover = useMutation({
    mutationFn: ({ id, collect }: { id: string; collect: boolean }) =>
      api(`/staff/orders/${id}/handover`, { method: 'POST', body: { collect } }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  // Incoming: orders waiting for acceptance. The café only sees orders it may accept itself.
  const incoming = orders.filter((o) => {
    if (o.status !== 'placed') return false;
    if (station === 'all' || selected?.isAcceptance) return true;
    return (
      o.tickets.every((t) => !t.isAcceptance) && o.tickets.some((t) => t.stationId === station)
    );
  });
  const upcoming =
    station !== 'all' && !selected?.isAcceptance
      ? ticketsFor(
          orders.filter((o) => o.status === 'placed'),
          station,
          ['held'],
        )
      : [];
  const queued = ticketsFor(orders, station, ['queued', 'scheduled']).sort(
    (a, b) => dueTime(a) - dueTime(b),
  );
  const preparing = ticketsFor(orders, station, ['preparing']);
  const ready = orders.filter(
    (o) =>
      o.status === 'ready' ||
      (station !== 'all' &&
        o.status !== 'completed' &&
        o.tickets.some((t) => t.stationId === station && t.status === 'ready')),
  );
  const closed = orders
    .filter((o) => ['completed', 'rejected', 'cancelled'].includes(o.status))
    .reverse();

  return (
    <Page
      title="سفارش‌ها"
      subtitle={
        isAcceptanceView
          ? 'سفارش‌های جدید اول اینجا تأیید می‌شوند؛ بعد هر ایستگاه تیکت خودش را می‌گیرد.'
          : 'تیکت‌های این ایستگاه بعد از تأیید رستوران وارد صف می‌شوند.'
      }
      actions={
        <Segmented<StationFilter>
          value={station}
          onChange={pickStation}
          label="ایستگاه"
          options={[
            { value: 'all', label: 'همه ایستگاه‌ها' },
            ...stations.map((s) => ({ value: s.id, label: s.label })),
          ]}
        />
      }
    >
      {board.isLoading ? (
        <Spinner />
      ) : (
        <div className="board">
          <Column title="منتظر تأیید" count={incoming.length} incoming>
            {incoming.map((o) => (
              <article
                key={o.id}
                className="ticket"
                data-age={ageBand(minutesSince(o.createdAt, now), 3)}
              >
                <TicketHead
                  order={o}
                  minutes={minutesSince(o.createdAt, now)}
                  onOpen={() => setOpenId(o.id)}
                />
                <OrderTags order={o} />
                <ul className="ticket__lines">
                  {o.lines.map((l) => (
                    <li key={l.id}>
                      <b className="num">{toFaDigits(l.quantity)}×</b>
                      <span>
                        {l.name}
                        <small>
                          {[
                            o.tickets.find((t) => t.stationId === l.stationId)?.stationName,
                            ...l.options.map((x) => x.name),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
                {o.note && <div className="ticket__note">{o.note}</div>}
                {auth.can('orders.accept') && (
                  <div className="ticket__actions">
                    <Button
                      variant="primary"
                      loading={accept.isPending && accept.variables === o.id}
                      onClick={() => accept.mutate(o.id)}
                    >
                      تأیید
                    </Button>
                    <Button onClick={() => setOpenId(o.id)}>ویرایش / رد</Button>
                  </div>
                )}
              </article>
            ))}
            {upcoming.map(({ order, ticket }) => (
              <article key={ticket.id} className="ticket" data-held="true">
                <TicketHead
                  order={order}
                  minutes={minutesSince(order.createdAt, now)}
                  onOpen={() => setOpenId(order.id)}
                />
                <Tag>منتظر تأیید رستوران</Tag>
                <StationLines order={order} stationId={ticket.stationId} />
              </article>
            ))}
            {!incoming.length && !upcoming.length && <EmptyCol text="سفارش تازه‌ای نیست" />}
          </Column>

          <Column title="در صف" count={queued.length}>
            {queued.map((card) => (
              <TicketCardView
                key={card.ticket.id}
                card={card}
                now={now}
                showStation={station === 'all'}
                onOpen={() => setOpenId(card.order.id)}
              >
                {auth.can('tickets.update') && (
                  <Button
                    block
                    loading={
                      ticketAction.isPending && ticketAction.variables?.id === card.ticket.id
                    }
                    onClick={() => ticketAction.mutate({ id: card.ticket.id, action: 'start' })}
                  >
                    شروع آماده‌سازی
                  </Button>
                )}
              </TicketCardView>
            ))}
            {!queued.length && <EmptyCol text="صف خالی است" />}
          </Column>

          <Column title="در حال آماده‌سازی" count={preparing.length}>
            {preparing.map((card) => (
              <TicketCardView
                key={card.ticket.id}
                card={card}
                now={now}
                showStation={station === 'all'}
                onOpen={() => setOpenId(card.order.id)}
              >
                {auth.can('tickets.update') && (
                  <Button
                    variant="primary"
                    block
                    loading={
                      ticketAction.isPending && ticketAction.variables?.id === card.ticket.id
                    }
                    onClick={() => ticketAction.mutate({ id: card.ticket.id, action: 'ready' })}
                  >
                    آماده شد
                  </Button>
                )}
              </TicketCardView>
            ))}
            {!preparing.length && <EmptyCol text="چیزی در حال آماده‌سازی نیست" />}
          </Column>

          <Column title="آماده تحویل" count={ready.length}>
            {ready.map((o) => {
              const unpaid = o.paymentState === 'unpaid' && o.total > o.paidAmount;
              const waitingOn = o.tickets.filter(
                (t) => t.status !== 'ready' && t.status !== 'cancelled' && t.status !== 'served',
              );
              return (
                <article
                  key={o.id}
                  className="ticket"
                  data-age={ageBand(minutesSince(o.readyAt, now), 5)}
                >
                  <TicketHead
                    order={o}
                    minutes={minutesSince(o.readyAt ?? o.createdAt, now)}
                    onOpen={() => setOpenId(o.id)}
                  />
                  <OrderTags order={o} />
                  {o.member?.name && <b>{o.member.name}</b>}
                  {waitingOn.length > 0 && (
                    <span className="hint">
                      منتظر {waitingOn.map((t) => t.stationName).join('، ')}
                    </span>
                  )}
                  {o.status === 'ready' && auth.can('orders.handover') && (
                    <Button
                      variant={unpaid ? 'ink' : 'primary'}
                      block
                      loading={handover.isPending && handover.variables?.id === o.id}
                      onClick={() => handover.mutate({ id: o.id, collect: unpaid })}
                    >
                      {unpaid
                        ? `دریافت ${formatToman(o.total - o.paidAmount)} و تحویل`
                        : 'تحویل شد'}
                    </Button>
                  )}
                </article>
              );
            })}
            {!ready.length && <EmptyCol text="سفارش آماده‌ای نیست" />}
          </Column>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Button
          variant="ghost"
          size="s"
          icon={showClosed ? 'chevronDown' : 'chevronLeft'}
          onClick={() => setShowClosed((s) => !s)}
        >
          سفارش‌های بسته‌شده ۳ ساعت اخیر ({toFaDigits(closed.length)})
        </Button>
        {showClosed && (
          <div className="panel" style={{ marginTop: 'var(--space-2)' }}>
            <table className="data">
              <tbody>
                {closed.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                    <td style={{ fontWeight: 900 }}>{toFaDigits(o.number)}</td>
                    <td>
                      <Tag tone={o.status === 'completed' ? 'green' : 'danger'}>
                        {ORDER_STATUS_LABELS[o.status]}
                      </Tag>
                    </td>
                    <td>{o.lines.map((l) => l.name).join('، ')}</td>
                    <td>{o.member?.name}</td>
                    <td className="n">{formatToman(o.total)}</td>
                    <td className="n">{formatTime(new Date(o.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </Page>
  );
}

const dueTime = (c: TicketCard) => (c.ticket.dueAt ? new Date(c.ticket.dueAt).getTime() : 0);

function Column({
  title,
  count,
  incoming,
  children,
}: {
  title: string;
  count: number;
  incoming?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={incoming ? 'col col--incoming' : 'col'} aria-label={title}>
      <div className="col__head">
        <span>{title}</span>
        <span className="count num">{toFaDigits(count)}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyCol({ text }: { text: string }) {
  return (
    <p className="hint" style={{ textAlign: 'center', padding: 'var(--space-5) 0' }}>
      {text}
    </p>
  );
}

function TicketHead({
  order,
  minutes,
  onOpen,
}: {
  order: OrderDto;
  minutes: number;
  onOpen: () => void;
}) {
  return (
    <div className="ticket__head">
      <button
        type="button"
        className="ticket__num num"
        onClick={onOpen}
        style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}
      >
        {toFaDigits(order.number)}
      </button>
      <span className="age">{ageLabel(minutes)}</span>
    </div>
  );
}

function OrderTags({ order }: { order: OrderDto }) {
  const pay = paymentLabel(order);
  return (
    <div className="ticket__meta">
      {order.spot ? <Tag tone="ink">{order.spot.label}</Tag> : <Tag>تحویل حضوری</Tag>}
      {scheduleLabel(order) && <Tag tone="info">{scheduleLabel(order)}</Tag>}
      <Tag tone={pay.tone}>{pay.text}</Tag>
      {order.member?.isVip && <Tag tone="ink">VIP</Tag>}
    </div>
  );
}

function StationLines({ order, stationId }: { order: OrderDto; stationId: string }) {
  const mine = order.lines.filter((l) => l.stationId === stationId && !l.removed);
  const others = order.lines.filter((l) => l.stationId !== stationId && !l.removed);
  return (
    <ul className="ticket__lines">
      {mine.map((l) => (
        <li key={l.id}>
          <b className="num">{toFaDigits(l.quantity)}×</b>
          <span>
            {l.name}
            {l.options.length > 0 && <small>{l.options.map((x) => x.name).join(' · ')}</small>}
            {l.note && <small style={{ color: 'var(--warning)' }}>{l.note}</small>}
          </span>
        </li>
      ))}
      {others.length > 0 && (
        <li className="other-station">
          <b />
          <small>
            + {toFaDigits(others.reduce((s, l) => s + l.quantity, 0))} قلم در ایستگاه دیگر
          </small>
        </li>
      )}
    </ul>
  );
}

function TicketCardView({
  card,
  now,
  showStation,
  onOpen,
  children,
}: {
  card: TicketCard;
  now: number;
  showStation: boolean;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const { order, ticket } = card;
  const scheduled = ticket.status === 'scheduled';
  const since = ticket.startedAt ?? ticket.dueAt ?? order.acceptedAt ?? order.createdAt;
  const minutes = scheduled ? 0 : minutesSince(since, now);
  return (
    <article className="ticket" data-age={scheduled ? 'ok' : ageBand(minutes)}>
      <TicketHead order={order} minutes={minutes} onOpen={onOpen} />
      <div className="ticket__meta">
        {showStation && <Tag tone="ink">{ticket.stationName}</Tag>}
        {scheduled && ticket.dueAt && (
          <Tag tone="info">شروع ساعت {formatTime(new Date(ticket.dueAt))}</Tag>
        )}
        {order.spot && <Tag>{order.spot.label}</Tag>}
        {scheduleLabel(order) && !scheduled && <Tag tone="info">{scheduleLabel(order)}</Tag>}
      </div>
      <StationLines order={order} stationId={ticket.stationId} />
      {order.note && <div className="ticket__note">{order.note}</div>}
      {children}
    </article>
  );
}
