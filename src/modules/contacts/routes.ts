import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  importFromPdf,
  listContacts,
  getContact,
  updateContact,
  updateContactStatus,
} from './service.js';

const listQuerySchema = z
  .object({
    status: z.enum(['active', 'disabled', 'bounced']).optional(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    company: z.string().optional(),
    q: z.string().optional(),
    snoFrom: z.coerce.number().int().positive().optional(),
    snoTo: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((v) => v.snoFrom === undefined || v.snoTo === undefined || v.snoFrom <= v.snoTo, {
    message: 'snoFrom must be less than or equal to snoTo',
    path: ['snoFrom'],
  });

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const patchSchema = z.object({
  status: z.enum(['active', 'disabled', 'bounced']).optional(),
  name: z.string().min(1).optional(),
  firstName: z.string().min(1).optional(),
  title: z.string().optional(),
  company: z.string().optional(),
});

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post('/contacts/import', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'multipart file field required' });
    if (!file.filename.toLowerCase().endsWith('.pdf')) {
      return reply.code(400).send({ error: 'file must be a PDF' });
    }

    const buffer = await file.toBuffer();
    const result = await importFromPdf(buffer, file.filename);

    return reply.send({
      ...result,
      // Surfaced explicitly so low-confidence rows get reviewed before sending.
      note:
        result.lowConfidence.length > 0
          ? `${result.lowConfidence.length} contacts have a title/company split that could not be ` +
            `verified against the email domain. Review them via GET /contacts?confidence=low`
          : undefined,
    });
  });

  app.get('/contacts', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return listContacts(query);
  });

  app.get('/contacts/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const contact = await getContact(id);
    if (!contact) return reply.code(404).send({ error: 'contact not found' });
    return contact;
  });

  app.patch('/contacts/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = patchSchema.parse(request.body);

    if (body.status) {
      const updated = await updateContactStatus(id, body.status);
      if (!updated) return reply.code(404).send({ error: 'contact not found' });
    }

    const { status: _status, ...fields } = body;
    if (Object.keys(fields).length > 0) {
      const updated = await updateContact(id, fields);
      if (!updated) return reply.code(404).send({ error: 'contact not found' });
      return updated;
    }

    const contact = await getContact(id);
    if (!contact) return reply.code(404).send({ error: 'contact not found' });
    return contact;
  });
}
