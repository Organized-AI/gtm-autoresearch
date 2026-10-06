import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';

// The site under test. Nothing here changes GTM; the test only drives the site and reads requests.
const url = process.env.SITE_URL;
if (!url) throw new Error('Set SITE_URL to the site whose tags you want to check.');

export default {
  targets: [{ engine: web(), app: { url } }],
  agents: {
    default: {
      // Read from the Vercel AI Gateway with AI_GATEWAY_API_KEY. See the README for switching to Jev.
      model: gateway(process.env.E2E_MODEL ?? 'anthropic/claude-sonnet-5-5'),
      system: 'You are a shopper. Do only what the step asks. Never enter payment details or place an order.',
    },
  },
} satisfies E2EConfig;
