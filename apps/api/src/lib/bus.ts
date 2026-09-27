import { EventEmitter } from 'node:events';

export type BusEvent =
  | { type: 'order.updated'; orderId: string; status: string; number: number }
  | { type: 'ticket.updated'; orderId: string; ticketId: string; stationId: string; status: string }
  | { type: 'stock.changed'; ingredientIds: string[] }
  | { type: 'payment.review'; paymentId: string }
  | { type: 'member.pending'; membershipId: string }
  | { type: 'menu.changed' };

/**
 * In-process pub/sub feeding the SSE streams. One API process serves a branch comfortably;
 * running several would need this swapped for Postgres LISTEN/NOTIFY behind the same interface.
 */
export class EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(branchId: string, event: BusEvent) {
    this.emitter.emit(`branch:${branchId}`, event);
    if ('orderId' in event) this.emitter.emit(`order:${event.orderId}`, event);
  }

  subscribeBranch(branchId: string, listener: (event: BusEvent) => void) {
    return this.on(`branch:${branchId}`, listener);
  }

  subscribeOrder(orderId: string, listener: (event: BusEvent) => void) {
    return this.on(`order:${orderId}`, listener);
  }

  private on(channel: string, listener: (event: BusEvent) => void) {
    this.emitter.on(channel, listener);
    return () => void this.emitter.off(channel, listener);
  }
}
