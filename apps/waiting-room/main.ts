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
};

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
  // Broadcast to other tabs
  try {
    const ch = new BroadcastChannel('vazue-queue');
    ch.postMessage(state);
    ch.close();
  } catch {
    /* ignore */
  }
}

function apiBase(): string {
  const params = new URLSearchParams(location.search);
  return params.get('api') ?? (import.meta as any).env?.VITE_QUEUE_API ?? 'http://localhost:3000';
}

function eventId(): string {
  return new URLSearchParams(location.search).get('event') ?? 'demo';
}

function returnUrl(): string | undefined {
  return new URLSearchParams(location.search).get('returnUrl') ?? undefined;
}

async function enroll(base: string, event: string): Promise<EnrollResponse> {
  const shared = readSharedState();
  const session = getCookie(COOKIE) ?? shared.session_id;
  const res = await fetch(`${base}/v1/events/${event}/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: session,
      return_url: returnUrl(),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function status(base: string, event: string, requestId: string): Promise<StatusResponse> {
  const url = new URL(`${base}/v1/events/${event}/status`);
  url.searchParams.set('request_id', requestId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function render(s: StatusResponse) {
  (document.getElementById('position') as HTMLElement).textContent = String(s.position);
  (document.getElementById('wait') as HTMLElement).textContent =
    Number.isFinite(s.wait_estimate_minutes) ? s.wait_estimate_minutes.toFixed(1) : '—';
  (document.getElementById('status') as HTMLElement).textContent = s.admitted
    ? 'Admitted — redirecting…'
    : `Status: ${s.status} · serving ${s.serving}`;
}

async function main() {
  const base = apiBase();
  const event = eventId();
  const el = document.getElementById('status')!;

  try {
    const shared = readSharedState();
    let requestId = shared.request_id;
    if (!requestId) {
      const enrolled = await enroll(base, event);
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
