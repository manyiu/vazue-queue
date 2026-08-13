'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

type Caps = {
  deployment?: string;
  limits?: { max_throughput_per_minute?: number; max_counter_shards?: number };
};

type EventRow = {
  event_id: string;
  room_id?: string;
  throughput_per_minute: number;
  paused: boolean;
  emergency_open: boolean;
  invite_only: boolean;
  dress_rehearsal: boolean;
  bot_protection: string;
};

type EventStats = {
  event_id: string;
  serving: number;
  queue_depth: number;
  waiting: number;
  admitted: number;
  throughput_per_minute: number;
  paused: boolean;
  emergency_open: boolean;
  dress_rehearsal: boolean;
};

type RoomTheme = {
  brandName?: string;
  message?: string;
  logoUrl?: string;
  accent?: string;
  background?: string;
};

type RoomRow = {
  room_id: string;
  name: string;
  theme: RoomTheme;
  queue: { default_throughput_per_minute?: number };
};

type AdminRuntimeConfig = {
  adminApiUrl?: string;
  cognitoDomain?: string;
  cognitoClientId?: string;
  cognitoRedirectUri?: string;
};

declare global {
  interface Window {
    __VAZUE_ADMIN_CONFIG__?: AdminRuntimeConfig;
  }
}

function runtimeConfig(): AdminRuntimeConfig {
  if (typeof window === 'undefined') return {};
  return window.__VAZUE_ADMIN_CONFIG__ ?? {};
}

function resolveApiBase(): string {
  return (
    runtimeConfig().adminApiUrl ||
    process.env.NEXT_PUBLIC_ADMIN_API ||
    'http://localhost:3001'
  );
}

function resolveCognito() {
  const rt = runtimeConfig();
  return {
    domain: rt.cognitoDomain || process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
    clientId: rt.cognitoClientId || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
    redirect:
      rt.cognitoRedirectUri ||
      process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ||
      (typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://localhost:5174/'),
  };
}

const DEV_AUTH = process.env.NEXT_PUBLIC_ADMIN_DEV_AUTH === '1';
const card: CSSProperties = {
  background: '#fff',
  padding: '1rem',
  borderRadius: 8,
  marginBottom: '0.75rem',
};

function tokenStorageKey() {
  return 'vazue_admin_token';
}

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(tokenStorageKey());
}

function writeToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(tokenStorageKey(), token);
  else localStorage.removeItem(tokenStorageKey());
}

function hostedLoginUrl(): string | null {
  const { domain, clientId, redirect } = resolveCognito();
  if (!domain || !clientId) return null;
  const u = new URL(`https://${domain}/oauth2/authorize`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('redirect_uri', redirect);
  return u.toString();
}

function parseHashToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get('access_token') ?? params.get('id_token');
}

export default function AdminHome() {
  const [token, setToken] = useState<string | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [stats, setStats] = useState<Record<string, EventStats>>({});
  const [throughput, setThroughput] = useState(100);
  const [dressRehearsal, setDressRehearsal] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [wizardName, setWizardName] = useState('Default room');
  const [wizardBrand, setWizardBrand] = useState('Vazue Queue');
  const [message, setMessage] = useState('');
  const [apiBase, setApiBase] = useState('http://localhost:3001');
  const loginUrl = useMemo(() => hostedLoginUrl(), []);

  useEffect(() => {
    setApiBase(resolveApiBase());
    const fromHash = parseHashToken();
    if (fromHash) {
      writeToken(fromHash);
      setToken(fromHash);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }
    setToken(readToken());
  }, []);

  const authHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    const t = token ?? readToken();
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }, [token]);

  const refresh = useCallback(async () => {
    const [c, e, r] = await Promise.all([
      fetch(`${apiBase}/v1/capabilities`, { headers: authHeaders() }).then((res) => {
        if (!res.ok) throw new Error(`capabilities ${res.status}`);
        return res.json();
      }),
      fetch(`${apiBase}/v1/events`, { headers: authHeaders() }).then((res) => {
        if (!res.ok) throw new Error(`events ${res.status}`);
        return res.json();
      }),
      fetch(`${apiBase}/v1/rooms`, { headers: authHeaders() }).then((res) =>
        res.ok ? res.json() : [],
      ),
    ]);
    setCaps(c);
    setEvents(e);
    setRooms(r);
    setWizardOpen(!wizardDismissed && (e as EventRow[]).length === 0);
    const next: Record<string, EventStats> = {};
    await Promise.all(
      (e as EventRow[]).map(async (ev) => {
        try {
          const s = await fetch(`${apiBase}/v1/events/${ev.event_id}/stats`, {
            headers: authHeaders(),
          }).then((res) => (res.ok ? res.json() : null));
          if (s) next[ev.event_id] = s;
        } catch {
          /* ignore per-event stats failures */
        }
      }),
    );
    setStats(next);
  }, [apiBase, authHeaders, wizardDismissed]);

  useEffect(() => {
    if (!token && !DEV_AUTH) return;
    refresh().catch((err) => setMessage(String(err)));
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, [token, apiBase, refresh]);

  async function createEvent(roomId = rooms[0]?.room_id || 'default') {
    const body = {
      event_id: `evt-${Date.now()}`,
      room_id: roomId,
      throughput_per_minute: throughput,
      paused: false,
      emergency_open: false,
      invite_only: false,
      dress_rehearsal: dressRehearsal,
      bot_protection: 'off',
      return_url: 'https://example.com/checkout',
    };
    const res = await fetch(`${apiBase}/v1/events`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMessage(await res.text());
      return;
    }
    setMessage('Event created');
    setWizardOpen(false);
    await refresh();
  }

  async function finishWizard() {
    const roomBody = {
      room_id: 'default',
      name: wizardName,
      theme: { brandName: wizardBrand, message: "You're in line. Please keep this tab open." },
      queue: { default_throughput_per_minute: throughput, counter_shards: 8 },
    };
    const roomRes = await fetch(`${apiBase}/v1/rooms`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(roomBody),
    });
    if (!roomRes.ok && roomRes.status !== 409) {
      setMessage(await roomRes.text());
      return;
    }
    await createEvent('default');
  }

  async function saveRoom(room: RoomRow) {
    const res = await fetch(`${apiBase}/v1/rooms/${room.room_id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        ...room,
        queue: {
          default_throughput_per_minute: room.queue.default_throughput_per_minute ?? 100,
          counter_shards: 8,
          token_ttl_seconds: 3600,
          visitor_record_ttl_hours: 24,
        },
      }),
    });
    if (!res.ok) setMessage(await res.text());
    else {
      setMessage('Room saved');
      await refresh();
    }
  }

  async function liveOverride(eventId: string, patch: Record<string, unknown>) {
    const res = await fetch(`${apiBase}/v1/events/${eventId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) setMessage(await res.text());
    else {
      setMessage('Updated');
      await refresh();
    }
  }

  async function exportCsv(eventId: string) {
    const res = await fetch(`${apiBase}/v1/events/${eventId}/export`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      setMessage(await res.text());
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${eventId}-stats.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded ${eventId}-stats.csv`);
  }

  function logout() {
    writeToken(null);
    setToken(null);
    setEvents([]);
    setRooms([]);
    setCaps(null);
    setStats({});
  }

  function useDevToken() {
    writeToken('dev-local-token');
    setToken('dev-local-token');
  }

  if (!token && !DEV_AUTH) {
    return (
      <main id="main" style={{ maxWidth: 520, margin: '0 auto', padding: '3rem 1.25rem' }}>
        <h1 style={{ fontSize: '2.4rem', letterSpacing: '-0.03em' }}>Vazue Queue</h1>
        <p style={{ color: '#444' }}>Sign in with Cognito to manage rooms and events.</p>
        {loginUrl ? (
          <p>
            <a href={loginUrl}>Sign in with Cognito</a>
          </p>
        ) : (
          <p style={{ color: '#8a5a00' }}>
            Deployed builds load Cognito settings from <code>/config.js</code>. For local, set
            NEXT_PUBLIC_COGNITO_* or enable NEXT_PUBLIC_ADMIN_DEV_AUTH=1.
          </p>
        )}
        {DEV_AUTH ? (
          <button type="button" onClick={useDevToken}>
            Continue in local dev mode
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <main id="main" style={{ maxWidth: 820, margin: '0 auto', padding: '3rem 1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: '2.4rem', letterSpacing: '-0.03em', marginBottom: '0.25rem' }}>
            Vazue Queue
          </h1>
          <p style={{ color: '#444', marginTop: 0 }}>
            Owner admin — rooms, live throttle, dress rehearsal
            {caps?.deployment ? ` · ${caps.deployment}` : ''}
          </p>
        </div>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </header>

      {wizardOpen ? (
        <section aria-labelledby="wizard-heading" style={{ ...card, marginTop: '2rem' }}>
          <h2 id="wizard-heading">First event</h2>
          <p>Create a room and a practice event. You can change throughput later without redeploying.</p>
          <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
            <label htmlFor="wizard-name">Room name</label>
            <input
              id="wizard-name"
              value={wizardName}
              onChange={(e) => setWizardName(e.target.value)}
            />
            <label htmlFor="wizard-brand">Waiting-room brand</label>
            <input
              id="wizard-brand"
              value={wizardBrand}
              onChange={(e) => setWizardBrand(e.target.value)}
            />
            <label htmlFor="wizard-throughput">Throughput / min</label>
            <input
              id="wizard-throughput"
              type="number"
              min={1}
              max={caps?.limits?.max_throughput_per_minute ?? 10000}
              value={throughput}
              onChange={(e) => setThroughput(Number(e.target.value))}
            />
            <label htmlFor="wizard-rehearsal">
              <input
                id="wizard-rehearsal"
                type="checkbox"
                checked={dressRehearsal}
                onChange={(e) => setDressRehearsal(e.target.checked)}
              />{' '}
              Start in dress rehearsal
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void finishWizard()}>
                Create room and event
              </button>
              <button
                type="button"
                onClick={() => {
                  setWizardDismissed(true);
                  setWizardOpen(false);
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="rooms-heading" style={{ marginTop: '2rem' }}>
        <h2 id="rooms-heading">Rooms</h2>
        {rooms.length === 0 ? <p>No rooms yet. Use First event above or create an event.</p> : null}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {rooms.map((room, idx) => (
            <li key={room.room_id} style={card}>
              <strong>{room.room_id}</strong>
              <div style={{ display: 'grid', gap: 8, marginTop: 8, maxWidth: 480 }}>
                <label htmlFor={`room-name-${idx}`}>Name</label>
                <input
                  id={`room-name-${idx}`}
                  defaultValue={room.name}
                  onBlur={(e) => {
                    const name = e.target.value;
                    if (name && name !== room.name) void saveRoom({ ...room, name });
                  }}
                />
                <label htmlFor={`room-brand-${idx}`}>Brand</label>
                <input
                  id={`room-brand-${idx}`}
                  defaultValue={room.theme?.brandName ?? ''}
                  onBlur={(e) => {
                    const brandName = e.target.value;
                    if (brandName !== (room.theme?.brandName ?? '')) {
                      void saveRoom({ ...room, theme: { ...room.theme, brandName } });
                    }
                  }}
                />
                <label htmlFor={`room-message-${idx}`}>Visitor message</label>
                <input
                  id={`room-message-${idx}`}
                  defaultValue={room.theme?.message ?? ''}
                  onBlur={(e) => {
                    const msg = e.target.value;
                    if (msg !== (room.theme?.message ?? '')) {
                      void saveRoom({ ...room, theme: { ...room.theme, message: msg } });
                    }
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="create-heading" style={{ marginTop: '2rem' }}>
        <h2 id="create-heading">Create event</h2>
        <label htmlFor="create-throughput">Throughput / min</label>{' '}
        <input
          id="create-throughput"
          type="number"
          value={throughput}
          onChange={(e) => setThroughput(Number(e.target.value))}
          max={caps?.limits?.max_throughput_per_minute ?? 10000}
        />{' '}
        <label htmlFor="create-rehearsal">
          <input
            id="create-rehearsal"
            type="checkbox"
            checked={dressRehearsal}
            onChange={(e) => setDressRehearsal(e.target.checked)}
          />{' '}
          Dress rehearsal
        </label>{' '}
        <button type="button" onClick={() => void createEvent()}>
          Create
        </button>
      </section>

      <section aria-labelledby="events-heading" style={{ marginTop: '2rem' }}>
        <h2 id="events-heading">Events</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {events.map((ev) => {
            const s = stats[ev.event_id];
            return (
              <li key={ev.event_id} style={card}>
                <strong>{ev.event_id}</strong>
                <div>
                  {ev.throughput_per_minute}/min · paused={String(ev.paused)} · bots=
                  {ev.bot_protection}
                  {ev.dress_rehearsal ? ' · dress rehearsal' : ''}
                  {ev.invite_only ? ' · invite only' : ''}
                </div>
                {s ? (
                  <div style={{ marginTop: 6, color: '#444', fontSize: '0.95rem' }}>
                    waiting {s.waiting} · serving {s.serving} · enrolled {s.queue_depth} · admitted{' '}
                    {s.admitted}
                  </div>
                ) : null}
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label htmlFor={`throttle-${ev.event_id}`}>
                    Throttle{' '}
                    <input
                      id={`throttle-${ev.event_id}`}
                      type="number"
                      defaultValue={ev.throughput_per_minute}
                      min={1}
                      max={caps?.limits?.max_throughput_per_minute ?? 10000}
                      style={{ width: 88 }}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (n && n !== ev.throughput_per_minute) {
                          void liveOverride(ev.event_id, { throughput_per_minute: n });
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => liveOverride(ev.event_id, { paused: !ev.paused })}>
                    {ev.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    onClick={() => liveOverride(ev.event_id, { emergency_open: !ev.emergency_open })}
                  >
                    {ev.emergency_open ? 'Close floodgates' : 'Open floodgates'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      liveOverride(ev.event_id, { dress_rehearsal: !ev.dress_rehearsal })
                    }
                  >
                    {ev.dress_rehearsal ? 'End rehearsal' : 'Dress rehearsal'}
                  </button>
                  <button
                    type="button"
                    onClick={() => liveOverride(ev.event_id, { invite_only: !ev.invite_only })}
                  >
                    {ev.invite_only ? 'Open enroll' : 'Invite only'}
                  </button>
                  <label htmlFor={`bots-${ev.event_id}`}>
                    Bot protection
                    <select
                      id={`bots-${ev.event_id}`}
                      value={ev.bot_protection}
                      onChange={(e) => liveOverride(ev.event_id, { bot_protection: e.target.value })}
                    >
                      <option value="off">Off</option>
                      <option value="rate_limit_only">Rate limit</option>
                      <option value="challenge_suspicious">CAPTCHA suspicious</option>
                      <option value="challenge_always">CAPTCHA always</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => void exportCsv(ev.event_id)}>
                    Export CSV
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {message ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </main>
  );
}
