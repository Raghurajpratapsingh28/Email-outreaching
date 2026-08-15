import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  listCampaigns,
  getCampaignStats,
  previewCampaign,
  previewCampaignForContact,
} from './service.js';

const contactFilterSchema = z
  .object({
    company: z.string().optional(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    contactIds: z.array(z.number().int().positive()).optional(),
    snoFrom: z.number().int().positive().optional(),
    snoTo: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .refine((v) => v.snoFrom === undefined || v.snoTo === undefined || v.snoFrom <= v.snoTo, {
    message: 'snoFrom must be less than or equal to snoTo',
    path: ['snoFrom'],
  });

const createSchema = z.object({
  name: z.string().min(1).max(120),
  templateId: z.number().int().positive(),
  contactFilter: contactFilterSchema.optional(),
  // Defaults to a dry run: starting a campaign should never send real mail by
  // accident. Sending requires opting in explicitly.
  dryRun: z.boolean().default(true),
  ratePerMinute: z.number().int().min(1).max(60).default(20),
  dailyCap: z.number().int().min(1).max(500).default(400),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.post('/campaigns', async (request, reply) => {
    const body = createSchema.parse(request.body);
    try {
      return await createCampaign(body);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/campaigns', async () => listCampaigns());

  app.get('/campaigns/:id/stats', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return getCampaignStats(id);
  });

  app.get('/campaigns/:id/preview', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(5) })
      .parse(request.query);
    try {
      return await previewCampaign(id, limit);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Preview the exact email one specific contact would receive. Renders only
  // — nothing is queued, persisted, or sent.
  app.post('/campaigns/:id/preview', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { contactId } = z
      .object({ contactId: z.coerce.number().int().positive() })
      .parse(request.body);
    try {
      return await previewCampaignForContact(id, contactId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/campaigns/:id/start', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      return await startCampaign(id);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/campaigns/:id/pause', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const row = await pauseCampaign(id);
    if (!row) return reply.code(404).send({ error: 'campaign not found' });
    return row;
  });

  app.post('/campaigns/:id/resume', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    try {
      return await resumeCampaign(id);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
