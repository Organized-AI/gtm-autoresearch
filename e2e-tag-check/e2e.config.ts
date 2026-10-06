import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { decisionExecutor } from '@e2e-dev/decision';
import { createJevGateway } from './jev-gateway-decision.ts';

// The site under test. Nothing here changes GTM; the test only drives the site and reads requests.
const url = process.env.SITE_URL;
if (!url) throw new Error('Set SITE_URL to the site whose tags you want to check.');

// Jev picks each browser action as a choice question, through jev-gateway's /v1/decide.
// JEV_DECIDE_MODEL is a jev-gateway route alias: point it at a tuned decision model in the gateway's
// DECIDE_ROUTES and this config does not change. No TypeSafe key is used here.
const jevGateway = createJevGateway({ consumer: 'e2e-tag-check' });

export default {
  targets: [{ engine: web(), app: { url } }],
  agents: {
    default: {
      executor: decisionExecutor({ model: jevGateway.decisionModel(process.env.JEV_DECIDE_MODEL ?? 'jev-latest') }),
    },
  },
} satisfies E2EConfig;
