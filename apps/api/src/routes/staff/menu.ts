import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  availabilityInput,
  categoryInput,
  menuItemInput,
  modifierGroupInput,
  recipeInput,
} from '@prochia/shared';
import type { AppContext } from '../../context';
import { requireStaff } from '../../lib/auth';
import { badRequest } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { recipeNutrition } from '../../modules/menu/catalog';
import {
  saveCategory,
  saveMenuItem,
  saveModifierGroup,
  setItemAvailability,
  setItemImage,
  setRecipe,
  staffMenu,
} from '../../modules/menu/service';

const idParam = z.object({ id: z.uuid() });
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function staffMenuRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/staff/menu', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.view');
    return staffMenu(ctx, branch);
  });

  app.post('/api/v1/staff/categories', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    return saveCategory(ctx, branch, null, parse(categoryInput, req.body));
  });

  app.put('/api/v1/staff/categories/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    return saveCategory(ctx, branch, parse(idParam, req.params).id, parse(categoryInput, req.body));
  });

  app.post('/api/v1/staff/items', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    return { id: await saveMenuItem(ctx, branch, null, parse(menuItemInput, req.body)) };
  });

  app.put('/api/v1/staff/items/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    return {
      id: await saveMenuItem(
        ctx,
        branch,
        parse(idParam, req.params).id,
        parse(menuItemInput, req.body),
      ),
    };
  });

  app.put('/api/v1/staff/items/:id/availability', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.availability');
    await setItemAvailability(
      ctx,
      branch,
      parse(idParam, req.params).id,
      parse(availabilityInput, req.body).isAvailable,
    );
    return { ok: true };
  });

  app.put('/api/v1/staff/items/:id/recipe', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    await setRecipe(
      ctx,
      branch,
      { menuItemId: parse(idParam, req.params).id },
      parse(recipeInput, req.body).lines,
    );
    return { ok: true };
  });

  app.put('/api/v1/staff/options/:id/recipe', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    await setRecipe(
      ctx,
      branch,
      { modifierOptionId: parse(idParam, req.params).id },
      parse(recipeInput, req.body).lines,
    );
    return { ok: true };
  });

  /** Preview nutrition for a recipe being edited, before saving. */
  app.post('/api/v1/staff/recipes/nutrition', async (req) => {
    await requireStaff(ctx, req, 'menu.view');
    return recipeNutrition(ctx.db, parse(recipeInput, req.body).lines);
  });

  app.post('/api/v1/staff/modifier-groups', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    return { id: await saveModifierGroup(ctx, branch, null, parse(modifierGroupInput, req.body)) };
  });

  app.put('/api/v1/staff/modifier-groups/:id', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    return {
      id: await saveModifierGroup(
        ctx,
        branch,
        parse(idParam, req.params).id,
        parse(modifierGroupInput, req.body),
      ),
    };
  });

  /** Raw image body (JPEG/PNG/WebP). Stored under UPLOAD_DIR and served from /uploads. */
  app.put('/api/v1/staff/items/:id/image', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    const { id } = parse(idParam, req.params);
    const ext = IMAGE_TYPES[req.headers['content-type'] ?? ''];
    if (!ext || !Buffer.isBuffer(req.body))
      throw badRequest('invalid_image', 'فقط تصویر JPG، PNG یا WebP');
    const dir = path.resolve(ctx.config.UPLOAD_DIR, 'menu', branch.slug);
    await mkdir(dir, { recursive: true });
    const file = `${id}-${randomBytes(4).toString('hex')}.${ext}`;
    await writeFile(path.join(dir, file), req.body);
    const url = `/uploads/menu/${branch.slug}/${file}`;
    await setItemImage(ctx, branch, id, url);
    return { imageUrl: url };
  });

  app.delete('/api/v1/staff/items/:id/image', async (req) => {
    const { branch } = await requireStaff(ctx, req, 'menu.edit');
    await setItemImage(ctx, branch, parse(idParam, req.params).id, null);
    return { ok: true };
  });
}
