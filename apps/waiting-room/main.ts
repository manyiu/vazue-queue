const COOKIE = 'vazue_qid';
const STORAGE = 'vazue_queue_state';

type EnrollResponse = {
  request_id: string;
  session_id: string;
  position: number;
  status: string;
};

type StatusResponse = {
  request_id: string;
  position: number;
  serving: number;
  wait_estimate_minutes: number;
  poll_after_seconds: number;
  status: string;
  admitted: boolean;
  admit_token?: string;
  return_url?: string;
  dress_rehearsal?: boolean;
};

type ActiveEventResponse = {
  room_id: string;
  event_id: string;
  return_url?: string;
  dress_rehearsal?: boolean;
  paused?: boolean;
};

type VazueRuntimeConfig = {
  brandName?: string;
  message?: string;
  logoUrl?: string;
  accent?: string;
  background?: string;
  turnstileSiteKey?: string;
  botMode?: string;
  defaultEventId?: string;
  defaultRoomId?: string;
  apiBase?: string;
};

declare global {
  interface Window {
    __VAZUE_CONFIG__?: VazueRuntimeConfig;
    turnstile?: {
      render: (
        el: string | HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => string;
    };
  }
}

function isLocalDev(): boolean {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function getCookie(name: string): string | undefined {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax; max-age=86400`;
}

function readSharedState(): { session_id?: string; request_id?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
  } catch {
    return {};
  }
}

function writeSharedState(state: { session_id: string; request_id: string }) {
  localStorage.setItem(STORAGE, JSON.stringify(state));
  setCookie(COOKIE, state.session_id);
  try {
    const ch = new BroadcastChannel('vazue-queue');
    ch.postMessage(state);
    ch.close();
  } catch {
    /* ignore */
  }
}

function runtimeConfig(): VazueRuntimeConfig {
  return window.__VAZUE_CONFIG__ ?? {};
}

function apiBase(): string {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('api');
  if (fromQuery !== null) return fromQuery;
  const fromConfig = runtimeConfig().apiBase;
  if (fromConfig !== undefined) return fromConfig;
  const fromVite = (import.meta as any).env?.VITE_QUEUE_API;
  if (fromVite) return fromVite;
  return isLocalDev() ? 'http://localhost:3000' : '';
}

function roomId(): string {
  return new URLSearchParams(location.search).get('room') ?? runtimeConfig().defaultRoomId ?? 'default';
}

function configuredEventId(): string | undefined {
  const fromConfig = runtimeConfig().defaultEventId;
  if (fromConfig) return fromConfig;
  return isLocalDev() ? 'demo' : undefined;
}

function eventFromQuery(): string | undefined {
  return new URLSearchParams(location.search).get('event') ?? undefined;
}

async function fetchActiveEvent(base: string, room: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${base}/v1/rooms/${encodeURIComponent(room)}/active-event`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as ActiveEventResponse;
    return body.event_id || undefined;
  } catch {
    return undefined;
  }
}

async function resolveEventId(base: string): Promise<string> {
  const explicit = eventFromQuery();
  if (explicit) return explicit;
  const active = await fetchActiveEvent(base, roomId());
  if (active) return active;
  const configured = configuredEventId();
  if (configured) return configured;
  throw new Error(
    'No queue event configured. Create an event in the admin portal or open this page with ?event=your-event-id.',
  );
}

function returnUrl(): string | undefined {
  return new URLSearchParams(location.search).get('returnUrl') ?? undefined;
}

function roomTheme(): VazueRuntimeConfig {
  const params = new URLSearchParams(location.search);
  const fromWindow = runtimeConfig();
  return {
    brandName: params.get('brand') ?? fromWindow.brandName ?? 'Vazue Queue',
    message:
      params.get('message') ??
      fromWindow.message ??
      "You're in line. Please keep this tab open.",
    logoUrl: params.get('logo') ?? fromWindow.logoUrl,
    accent: params.get('accent') ?? fromWindow.accent,
    background: params.get('bg') ?? fromWindow.background,
    turnstileSiteKey:
      params.get('turnstileSiteKey') ??
      fromWindow.turnstileSiteKey ??
      (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY,
    botMode: params.get('botMode') ?? fromWindow.botMode ?? 'off',
  };
}

function applyTheme(cfg: VazueRuntimeConfig) {
  const brand = document.getElementById('brand');
  const message = document.getElementById('message');
  if (brand) brand.textContent = cfg.brandName ?? 'Vazue Queue';
  if (message) message.textContent = cfg.message ?? '';
  if (cfg.accent) document.documentElement.style.setProperty('--accent', cfg.accent);
  if (cfg.background) document.documentElement.style.setProperty('--bg', cfg.background);
  if (cfg.logoUrl) {
    const logo = document.getElementById('logo') as HTMLImageElement | null;
    if (logo) {
      logo.src = cfg.logoUrl;
      logo.hidden = false;
    }
  }
}

function needsTurnstile(cfg: VazueRuntimeConfig): boolean {
  const mode = cfg.botMode ?? 'off';
  return (
    Boolean(cfg.turnstileSiteKey) &&
    (mode === 'challenge_always' || mode === 'challenge_suspicious')
  );
}

function loadTurnstile(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Turnstile'));
    document.head.appendChild(s);
  });
}

async function obtainTurnstileToken(siteKey: string): Promise<string> {
  await loadTurnstile();
  const host = document.getElementById('turnstile');
  if (!host) throw new Error('Missing #turnstile container');
  host.hidden = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Turnstile timeout')), 60_000);
    window.turnstile!.render(host, {
      sitekey: siteKey,
      callback: (token) => {
        clearTimeout(timer);
        resolve(token);
      },
    });
  });
}

function formatApiError(status: number, body: string, event: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) message = parsed.error;
  } catch {
    /* use raw body */
  }
  if (status === 404) {
    return `Queue event "${event}" was not found. Create it in the admin portal or check ?event=.`;
  }
  if (status === 409) {
    return message.includes('paused')
      ? 'The queue is paused. Please wait for the operator to reopen it.'
      : message;
  }
  if (status === 0 || message.toLowerCase().includes('failed to fetch')) {
    return 'Cannot reach the queue API. Confirm the stack is deployed and this page is served from the waiting room CloudFront URL.';
  }
  return message || `Request failed (${status})`;
}

async function enroll(
  base: string,
  event: string,
  turnstileToken?: string,
): Promise<EnrollResponse> {
  const shared = readSharedState();
  const session = getCookie(COOKIE) ?? shared.session_id;
  let res: Response;
  try {
    res = await fetch(`${base}/v1/events/${encodeURIComponent(event)}/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session,
        return_url: returnUrl(),
        turnstile_token: turnstileToken,
      }),
    });
  } catch {
    throw new Error(formatApiError(0, 'Failed to fetch', event));
  }
  if (res.status !== 201 && res.status !== 202) {
    throw new Error(formatApiError(res.status, await res.text(), event));
  }
  const body = (await res.json()) as EnrollResponse;
  if (body.session_id) setCookie(COOKIE, body.session_id);
  return body;
}

async function status(base: string, event: string, requestId: string): Promise<StatusResponse> {
  const url = new URL(`${base}/v1/events/${encodeURIComponent(event)}/status`, location.origin);
  url.searchParams.set('request_id', requestId);
  const res = await fetch(url);
  if (res.status === 404) {
    return {
      request_id: requestId,
      position: 0,
      serving: 0,
      wait_estimate_minutes: 0,
      poll_after_seconds: 2,
      status: 'enrolled',
      admitted: false,
    };
  }
  if (!res.ok) throw new Error(formatApiError(res.status, await res.text(), event));
  return res.json();
}

function render(s: StatusResponse) {
  (document.getElementById('position') as HTMLElement).textContent = String(s.position);
  (document.getElementById('wait') as HTMLElement).textContent = Number.isFinite(
    s.wait_estimate_minutes,
  )
    ? s.wait_estimate_minutes.toFixed(1)
    : '—';
  (document.getElementById('status') as HTMLElement).textContent = s.admitted
    ? 'Admitted — redirecting…'
    : `Status: ${s.status} · serving ${s.serving}`;
  const banner = document.getElementById('rehearsal');
  if (banner) banner.hidden = !s.dress_rehearsal;
}

async function main() {
  const cfg = roomTheme();
  applyTheme(cfg);
  const base = apiBase();
  const el = document.getElementById('status')!;

  try {
    const event = await resolveEventId(base);
    const shared = readSharedState();
    let requestId = shared.request_id;
    if (!requestId) {
      let token: string | undefined;
      if (needsTurnstile(cfg) && cfg.turnstileSiteKey) {
        el.textContent = 'Complete the challenge to join the queue…';
        token = await obtainTurnstileToken(cfg.turnstileSiteKey);
      }
      const enrolled = await enroll(base, event, token);
      writeSharedState({ session_id: enrolled.session_id, request_id: enrolled.request_id });
      requestId = enrolled.request_id;
      render({
        request_id: enrolled.request_id,
        position: enrolled.position,
        serving: 0,
        wait_estimate_minutes: 0,
        poll_after_seconds: 5,
        status: enrolled.status,
        admitted: false,
      });
    }

    const loop = async () => {
      const s = await status(base, event, requestId!);
      render(s);
      if (s.admitted && s.admit_token) {
        const dest = s.return_url || returnUrl() || '/';
        const u = new URL(dest, location.origin);
        u.searchParams.set('vazue_token', s.admit_token);
        location.href = u.toString();
        return;
      }
      setTimeout(loop, (s.poll_after_seconds || 5) * 1000);
    };
    await loop();
  } catch (e) {
    el.textContent = e instanceof Error ? e.message : String(e);
  }
}

main();
