import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logger } from '../../plugins/logger.js';
import { redis } from '../jobs/queue.js';
import {
  getSendModeStatus,
  setDryRunOverride,
  setLiveOverride,
  clearSendModeOverride,
} from './sendMode.js';

// Deliberate friction: going live requires typing this exact phrase, not
// just flipping a boolean. A stray click on a toggle should not be able to
// authorize real outbound mail to real people.
const CONFIRM_PHRASE = 'SEND REAL EMAILS';

const goLiveSchema = z.object({
  confirm: z.literal(CONFIRM_PHRASE, {
    errorMap: () => ({
      message: `To go live, POST { "confirm": "${CONFIRM_PHRASE}" } — this is intentional friction, not a bug.`,
    }),
  }),
});

export async function sendModeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/send-mode', async () => getSendModeStatus(redis));

  app.post('/send-mode/live', async (request, reply) => {
    const body = goLiveSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: `To go live, POST { "confirm": "${CONFIRM_PHRASE}" }`,
      });
    }
    try {
      await setLiveOverride(redis);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    logger.warn('send mode set to LIVE via API — real email will now be sent');
    return getSendModeStatus(redis);
  });

  app.post('/send-mode/dry-run', async () => {
    await setDryRunOverride(redis);
    logger.info('send mode set to DRY RUN via API');
    return getSendModeStatus(redis);
  });

  app.delete('/send-mode', async () => {
    await clearSendModeOverride(redis);
    logger.info('send mode override cleared — reverting to env default');
    return getSendModeStatus(redis);
  });
}
