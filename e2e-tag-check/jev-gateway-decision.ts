// AI SDK decision model (Experimental_DecisionModelV4) backed by jev-gateway's POST /v1/decide.
// Use it anywhere an AI SDK decision model is accepted, for example e2e's decisionExecutor:
//
//   import { createJevGateway } from './jev-gateway-decision';
//   const jevGateway = createJevGateway();                 // JEV_GATEWAY_URL + JEV_GATEWAY_TOKEN from env
//   decisionExecutor({ model: jevGateway.decisionModel('jev-latest'), textModel })
//
// The model id is a jev-gateway route alias, not a TypeSafe model: the gateway maps it (DECIDE_ROUTES) to
// the decision model that serves it, so pointing an alias at a tuned model changes nothing here.
// No TypeSafe key or URL is ever used by this file. No dependencies.

type Input = string | Record<string, unknown> | readonly unknown[];
type Question =
  | { readonly type: 'choice'; readonly instructions: Input; readonly criteria: Readonly<Record<string, Input | null>> }
  | { readonly type: 'score'; readonly instructions: Input; readonly criteria: readonly (Input | null)[] }
  | { readonly type: 'boolean'; readonly instructions: Input; readonly criteria?: { readonly true?: Input | null; readonly false?: Input | null } };
type Answer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number };
interface CallOptions { state: Input; questions: Readonly<Record<string, Question>>; abortSignal?: AbortSignal; headers?: Record<string, string | undefined> }
interface Result {
  answers: Record<string, Answer>;
  rounding?: { probabilityDecimals?: number; scoreDecimals?: number };
  usage?: { inputTokens?: number; outputTokens?: number };
  /** This client never adds warnings. */
  warnings: never[];
  providerMetadata?: Record<string, Record<string, string | number | null | Record<string, number>>>;
  response?: { id?: string; modelId?: string; headers?: Record<string, string> };
}

export interface JevGatewaySettings {
  /** jev-gateway base URL. Default: JEV_GATEWAY_URL, else https://jev-gateway.jordan-691.workers.dev */
  baseURL?: string;
  /** Bearer token. Default: JEV_GATEWAY_TOKEN. */
  token?: string;
  /** Sent as x-jev-consumer so the gateway's audit says who called (for example "e2e"). */
  consumer?: string;
  fetch?: typeof fetch;
}

/** A failed or invalid gateway call. `code` is the gateway's error code when it sent one. */
export class JevGatewayError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number, readonly requestId?: string | null) {
    super(message);
    this.name = 'JevGatewayError';
  }
}

/** Reads an env var in Node, Bun or Deno-with-process, and returns undefined elsewhere (Workers: pass settings instead). */
const env = (name: string): string | undefined => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

export class JevGatewayDecisionModel {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'jev-gateway.decision';
  readonly supportedQuestionTypes = ['choice', 'score', 'boolean'] as const;
  constructor(readonly modelId: string, private readonly settings: JevGatewaySettings = {}) {}

  async doDecide({ state, questions, abortSignal, headers }: CallOptions): Promise<Result> {
    const base = (this.settings.baseURL ?? env('JEV_GATEWAY_URL') ?? 'https://jev-gateway.jordan-691.workers.dev').replace(/\/+$/, '');
    const token = this.settings.token ?? env('JEV_GATEWAY_TOKEN');
    if (!token) throw new JevGatewayError('jev-gateway token missing: set JEV_GATEWAY_TOKEN or pass { token }', 'missing_token');
    const native = Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, q.type === 'boolean' ? { ...q, type: 'noul' } : q]));
    const res = await (this.settings.fetch ?? fetch)(`${base}/v1/decide`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(this.settings.consumer ? { 'x-jev-consumer': this.settings.consumer } : {}),
        ...Object.fromEntries(Object.entries(headers ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')),
      },
      body: JSON.stringify({ model: this.modelId, state, questions: native }),
      signal: abortSignal,
    });
    const requestId = res.headers.get('x-jev-gateway-request-id');
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new JevGatewayError(`jev-gateway /v1/decide failed: ${json?.error?.code ?? `HTTP ${res.status}`}`, json?.error?.code ?? `http_${res.status}`, res.status, requestId);
    if (!json || typeof json.answers !== 'object') throw new JevGatewayError('jev-gateway returned no answers', 'response_invalid', res.status, requestId);

    const answers: Record<string, Answer> = {};
    const confidence: Record<string, number> = {};
    for (const id of Object.keys(questions)) {
      const a = json.answers[id];
      if (!a) throw new JevGatewayError(`jev-gateway returned no answer for ${id}`, 'response_invalid', res.status, requestId);
      if (a.type === 'noul') answers[id] = { type: 'boolean', probability: a.noul };
      else if (a.type === 'choice') answers[id] = { type: 'choice', choice: a.choice, probabilities: a.probabilities };
      else if (a.type === 'score') answers[id] = { type: 'score', score: a.score, probabilities: a.probabilities };
      else throw new JevGatewayError(`jev-gateway answered ${id} with type ${String(a.type)}`, 'response_invalid', res.status, requestId);
      if (a.type !== 'noul' && typeof a.confidence === 'number') confidence[id] = a.confidence;
    }
    return {
      answers,
      usage: { inputTokens: json.usage?.input_tokens ?? undefined, outputTokens: json.usage?.output_tokens ?? undefined },
      rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
      warnings: [],
      providerMetadata: { 'jev-gateway': { confidence, requestId, servedModel: json.served_model ?? null } },
      response: { ...(requestId ? { id: requestId } : {}), modelId: json.served_model ?? this.modelId },
    };
  }
  /** @deprecated AI SDK alias for doDecide. */
  doEvaluate(options: CallOptions) { return this.doDecide(options); }
}

export function createJevGateway(settings: JevGatewaySettings = {}) {
  const decisionModel = (alias: string) => new JevGatewayDecisionModel(alias, settings);
  return { specificationVersion: 'v4' as const, decisionModel, evaluationModel: decisionModel };
}
