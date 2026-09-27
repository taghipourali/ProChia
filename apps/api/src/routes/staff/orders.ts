import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  acceptOrderInput,
  handoverInput,
  paymentReviewInput,
  rejectOrderInput,
  ticketActionInput,
} from '@prochia/shared';
import type { AppContext } from '../../context';
import { memberships, payments, users } from '../../db/schema';
import { requireStaff } from '../../lib/auth';
import { openEventStream } from '../../lib/http';
import { parse } from '../../lib/validate';
import {
  acceptOrder,
  collectPayment,
  handoverOrder,
  rejectOrder,
  staffBoard,
  staffOrder,
  updateTicket,
} from '../../modules/orders/service';
import { reviewPayment } from '../../modules/payments/service';

const idParam = z.object({ id: z.uuid() });

export function staffOrderRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/staff/me', async (req) => {
    const { staff, branch } = await requireStaff(ctx, req);
    return {
      staff: {
        id: staff.id,
        name: staff.name,
        username: staff.username,
        role: staff.role,
        branchId: staff.branchId,
      },
      branch: {
        id: branch.id,
        slug: branch.slug,
        name: branch.name,
        gymName: branch.gymName,
        settings: branch.settings,
      },
    };
  });

  /** Live feed for boards and the storage screen. */
  app.get('/api/v1/staff/stream', async (req, reply) => {
    const { branch } = await requireStaff(ctx, req);
    openEventStream(req, reply, (send) => ctx.bus.subscribeBranch(branch.id, send));
  });

  app.get('/api/v1/staff/board', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'orders.view');
    return staffBoard(ctx, branch.id);
  });

  app.get('/api/v1/staff/orders/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'orders.view');
    return staffOrder(ctx, branch.id, parse(idParam, req.params).id);
  });

  app.post('/api/v1/staff/orders/:id/accept', async (req) => {
    const auth = await requireStaff(ctx, req, 'orders.accept');
    const { id } = parse(idParam, req.params);
    const opts = parse(acceptOrderInput, req.body ?? {});
    const result = await acceptOrder(
      ctx,
      { kind: 'staff', staff: auth.staff },
      auth.branch,
      id,
      opts,
    );
    return { ...result, order: await staffOrder(ctx, auth.branch.id, id) };
  });

  app.post('/api/v1/staff/orders/:id/reject', async (req) => {
    const auth = await requireStaff(ctx, req, 'orders.accept');
    const { id } = parse(idParam, req.params);
    await rejectOrder(ctx, auth, id, parse(rejectOrderInput, req.body).reason);
    return staffOrder(ctx, auth.branch.id, id);
  });

  app.post('/api/v1/staff/tickets/:id', async (req) => {
    const auth = await requireStaff(ctx, req, 'tickets.update');
    await updateTicket(
      ctx,
      auth,
      parse(idParam, req.params).id,
      parse(ticketActionInput, req.body).action,
    );
    return { ok: true };
  });

  app.post('/api/v1/staff/orders/:id/collect', async (req) => {
    const auth = await requireStaff(ctx, req, 'orders.handover');
    const { id } = parse(idParam, req.params);
    await collectPayment(ctx, auth, id);
    return staffOrder(ctx, auth.branch.id, id);
  });

  app.post('/api/v1/staff/orders/:id/handover', async (req) => {
    const auth = await requireStaff(ctx, req, 'orders.handover');
    const { id } = parse(idParam, req.params);
    await handoverOrder(ctx, auth, id, parse(handoverInput, req.body ?? {}));
    return staffOrder(ctx, auth.branch.id, id);
  });

  app.get<{ Querystring: { status?: string } }>('/api/v1/staff/payments', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'payments.review');
    const statuses =
      req.query.status === 'all'
        ? ['awaiting_review', 'succeeded', 'failed', 'pending', 'cancelled']
        : ['awaiting_review'];
    return ctx.db
      .select({
        payment: payments,
        member: { firstName: users.firstName, lastName: users.lastName, phone: users.phone },
      })
      .from(payments)
      .innerJoin(memberships, eq(memberships.id, payments.membershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(payments.branchId, branch.id),
          inArray(payments.status, statuses as ('awaiting_review' | 'succeeded')[]),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(200);
  });

  app.post('/api/v1/staff/payments/:id/review', async (req) => {
    const auth = await requireStaff(ctx, req, 'payments.review');
    const { approve, note } = parse(paymentReviewInput, req.body);
    await reviewPayment(ctx, auth, parse(idParam, req.params).id, approve, note ?? undefined);
    return { ok: true };
  });
}
