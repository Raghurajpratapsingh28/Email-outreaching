import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createTemplate,
  updateTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  previewTemplate,
} from './service.js';
import { TEMPLATE_VARIABLES, TemplateRenderError } from './render.js';

// bodyText is optional on create: an HTML-only template (bodyText omitted,
// bodyHtml given) has its plain-text fallback auto-derived from the HTML.
const templateFieldsSchema = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(300),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional().nullable(),
});

const createSchema = templateFieldsSchema.refine(
  (v) => Boolean(v.bodyText?.trim()) || Boolean(v.bodyHtml?.trim()),
  {
    message: 'Provide bodyText, or bodyHtml to auto-derive a plain-text fallback from',
    path: ['bodyText'],
  },
);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates/variables', async () => ({
    variables: TEMPLATE_VARIABLES,
    notes: {
      name: 'Full name, e.g. "Akanksha Puri". NOT for salutations — use {{firstName}} instead.',
      firstName: 'First name only, e.g. "Akanksha". Use this in salutations: "Dear {{firstName}}," → "Dear Akanksha,"',
      fullName: 'Alias of {{name}} — full name as stored, e.g. "Akanksha Puri"',
      title: 'Job title. Empty value fails the render rather than sending broken text.',
      company: 'Company name, e.g. "SourceFuse Technologies". Empty value fails the render.',
      email: "The contact's own email address.",
    },
  }));

  app.post('/templates', async (request, reply) => {
    const body = createSchema.parse(request.body);
    try {
      return await createTemplate(body);
    } catch (err) {
      if (err instanceof TemplateRenderError) {
        return reply.code(400).send({ error: err.message, variable: err.variable });
      }
      throw err;
    }
  });

  app.get('/templates', async () => listTemplates());

  app.get('/templates/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const row = await getTemplate(id);
    if (!row) return reply.code(404).send({ error: 'template not found' });
    return row;
  });

  app.patch('/templates/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = templateFieldsSchema.partial().parse(request.body);
    try {
      const row = await updateTemplate(id, body);
      if (!row) return reply.code(404).send({ error: 'template not found' });
      return row;
    } catch (err) {
      if (err instanceof TemplateRenderError) {
        return reply.code(400).send({ error: err.message, variable: err.variable });
      }
      throw err;
    }
  });

  app.delete('/templates/:id', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const ok = await deleteTemplate(id);
    if (!ok) return reply.code(404).send({ error: 'template not found' });
    return reply.code(204).send();
  });

  // Renders against a real contact and sends nothing.
  app.post('/templates/:id/preview', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { contactId } = z
      .object({ contactId: z.coerce.number().int().positive() })
      .parse(request.body);
    try {
      return await previewTemplate(id, contactId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
