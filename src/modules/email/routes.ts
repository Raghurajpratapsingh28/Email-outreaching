import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { suppressionList, contacts } from '../../db/schema.js';
import { normalizeEmail } from '../../utils/normalize.js';

const addSchema = z.object({
  email: z.string().email(),
  reason: z.string().max(500).optional(),
});

export async function suppressionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/suppression', async () =>
    db.select().from(suppressionList).orderBy(desc(suppressionList.id)),
  );

  app.post('/suppression', async (request) => {
    const body = addSchema.parse(request.body);
    const email = normalizeEmail(body.email);

    const [row] = await db
      .insert(suppressionList)
      .values({ email, reason: body.reason ?? null })
      .onConflictDoUpdate({
        target: suppressionList.email,
        set: { reason: body.reason ?? null },
      })
      .returning();

    // Also disable the contact so it stops matching future campaign filters.
    await db
      .update(contacts)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(eq(contacts.email, email));

    return row;
  });

  app.delete('/suppression/:email', async (request, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.params);
    const rows = await db
      .delete(suppressionList)
      .where(eq(suppressionList.email, normalizeEmail(email)))
      .returning({ id: suppressionList.id });

    if (rows.length === 0) return reply.code(404).send({ error: 'not suppressed' });
    return reply.code(204).send();
  });
}
