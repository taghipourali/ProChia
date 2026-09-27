import type { AppContext } from '../context';
import type { BusEvent } from './bus';

/**
 * Collects side effects (realtime events, follow-up work) during a transaction and runs them only
 * once it has committed — so nobody is told about an order that was rolled back.
 */
export class AfterCommit {
  private readonly events: { branchId: string; event: BusEvent }[] = [];
  private readonly tasks: (() => Promise<unknown>)[] = [];

  publish(branchId: string, event: BusEvent) {
    this.events.push({ branchId, event });
  }

  run(task: () => Promise<unknown>) {
    this.tasks.push(task);
  }

  async flush(ctx: AppContext, log?: (err: unknown) => void) {
    for (const { branchId, event } of this.events) ctx.bus.publish(branchId, event);
    for (const task of this.tasks) {
      try {
        await task();
      } catch (err) {
        (log ?? console.error)(err);
      }
    }
  }
}
