// Local check: a two-page test shop and a stand-in for jev-gateway /v1/decide, both on :8899
// (local/fake-gateway.mjs). Proves the wiring e2e -> jev-gateway-decision.ts -> /v1/decide -> tag
// assertions without a real token. The stand-in picks options by keyword; it is not Jev.
// Set CDP_ENDPOINT to attach to a running Chromium instead of letting e2e launch one.
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { decisionExecutor } from '@e2e-dev/decision';
import { createJevGateway } from './jev-gateway-decision.ts';

const jevGateway = createJevGateway({ consumer: 'e2e-tag-check', baseURL: 'http://127.0.0.1:8899', token: 'local-test-token' });
const cdp = process.env.CDP_ENDPOINT;

export default {
  targets: [{ engine: web(cdp ? { connect: { cdpEndpoint: () => cdp } } : {}), app: { url: 'http://127.0.0.1:8899' } }],
  agents: { default: { executor: decisionExecutor({ model: jevGateway.decisionModel('jev-latest') }) } },
} satisfies E2EConfig;
