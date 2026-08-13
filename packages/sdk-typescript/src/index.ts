export interface EnrollRequest {
  session_id?: string;
  return_url?: string;
  invite_code?: string;
  turnstile_token?: string;
}

export interface EnrollResponse {
  request_id: string;
  session_id: string;
  position: number;
  status: string;
}

export interface StatusResponse {
  request_id: string;
  position: number;
  serving: number;
  wait_estimate_minutes: number;
  poll_after_seconds: number;
  status: string;
  admitted: boolean;
  admit_token?: string;
  return_url?: string;
}

export interface QueueClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export class QueueClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: QueueClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async enroll(eventId: string, body: EnrollRequest = {}): Promise<EnrollResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/events/${eventId}/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<EnrollResponse>;
  }

  async status(eventId: string, requestId: string): Promise<StatusResponse> {
    const url = new URL(`${this.baseUrl}/v1/events/${eventId}/status`);
    url.searchParams.set('request_id', requestId);
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`status failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<StatusResponse>;
  }

  /** Poll until admitted or maxAttempts. Uses adaptive poll_after_seconds from API. */
  async waitUntilAdmitted(
    eventId: string,
    requestId: string,
    opts: { maxAttempts?: number; signal?: AbortSignal } = {},
  ): Promise<StatusResponse> {
    const max = opts.maxAttempts ?? 3600;
    for (let i = 0; i < max; i++) {
      if (opts.signal?.aborted) throw new Error('aborted');
      const s = await this.status(eventId, requestId);
      if (s.admitted) return s;
      await sleep((s.poll_after_seconds || 5) * 1000);
    }
    throw new Error('timed out waiting for admission');
  }

  async health(): Promise<{ status: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`);
    return res.json() as Promise<{ status: string }>;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
