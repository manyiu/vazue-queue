'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Caps = {
  deployment?: string;
  limits?: { max_throughput_per_minute?: number; max_counter_shards?: number };
};

type EventRow = {
  event_id: string;
  throughput_per_minute: number;
  paused: boolean;
  emergency_open: boolean;
  bot_protection: string;
};

const API = process.env.NEXT_PUBLIC_ADMIN_API ?? 'http://localhost:3001';
const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const COGNITO_REDIRECT =
  process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ??
  (typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://localhost:5174/');
const DEV_AUTH = process.env.NEXT_PUBLIC_ADMIN_DEV_AUTH === '1';

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
  if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID) return null;
  const u = new URL(`https://${COGNITO_DOMAIN}/oauth2/authorize`);
  u.searchParams.set('client_id', COGNITO_CLIENT_ID);
  u.searchParams.set('response_type', 'token');
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('redirect_uri', COGNITO_REDIRECT);
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
  const [throughput, setThroughput] = useState(100);
  const [message, setMessage] = useState('');
  const loginUrl = useMemo(() => hostedLoginUrl(), []);

  useEffect(() => {
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

  async function refresh() {
    const [c, e] = await Promise.all([
      fetch(`${API}/v1/capabilities`, { headers: authHeaders() }).then((r) => {
        if (!r.ok) throw new Error(`capabilities ${r.status}`);
        return r.json();
      }),
      fetch(`${API}/v1/events`, { headers: authHeaders() }).then((r) => {
        if (!r.ok) throw new Error(`events ${r.status}`);
        return r.json();
      }),
    ]);
    setCaps(c);
    setEvents(e);
  }

  useEffect(() => {
    if (!token && !DEV_AUTH) return;
    refresh().catch((err) => setMessage(String(err)));
  }, [token]);

  async function createEvent() {
    const body = {
      event_id: `evt-${Date.now()}`,
      room_id: 'default',
      throughput_per_minute: throughput,
      paused: false,
      emergency_open: false,
      invite_only: false,
      bot_protection: 'off',
      return_url: 'https://example.com/checkout',
    };
    const res = await fetch(`${API}/v1/events`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMessage(await res.text());
      return;
    }
    setMessage('Event created');
    await refresh();
  }

  async function liveOverride(eventId: string, patch: Record<string, unknown>) {
    const res = await fetch(`${API}/v1/events/${eventId}`, {
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

  function logout() {
    writeToken(null);
    setToken(null);
    setEvents([]);
    setCaps(null);
  }

  function useDevToken() {
    writeToken('dev-local-token');
    setToken('dev-local-token');
  }

  if (!token && !DEV_AUTH) {
    return (
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '3rem 1.25rem' }}>
        <h1 style={{ fontSize: '2.4rem', letterSpacing: '-0.03em' }}>Vazue Queue</h1>
        <p style={{ color: '#5c5c5c' }}>Sign in with Cognito to manage rooms and events.</p>
        {loginUrl ? (
          <p>
            <a href={loginUrl}>Sign in with Cognito</a>
          </p>
        ) : (
          <p style={{ color: '#8a5a00' }}>
            Set NEXT_PUBLIC_COGNITO_DOMAIN and NEXT_PUBLIC_COGNITO_CLIENT_ID, or enable
            NEXT_PUBLIC_ADMIN_DEV_AUTH=1 for local admin-api without JWT.
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
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '3rem 1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: '2.4rem', letterSpacing: '-0.03em', marginBottom: '0.25rem' }}>
            Vazue Queue
          </h1>
          <p style={{ color: '#5c5c5c', marginTop: 0 }}>Owner admin — rooms, events, live controls</p>
        </div>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </header>

      <section style={{ marginTop: '2rem' }}>
        <h2>Capabilities</h2>
        <pre style={{ background: '#fff', padding: '1rem', borderRadius: 8, overflow: 'auto' }}>
          {JSON.stringify(caps, null, 2)}
        </pre>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Create event</h2>
        <label>
          Throughput / min{' '}
          <input
            type="number"
            value={throughput}
            onChange={(e) => setThroughput(Number(e.target.value))}
            max={caps?.limits?.max_throughput_per_minute ?? 10000}
          />
        </label>{' '}
        <button type="button" onClick={createEvent}>
          Create
        </button>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Events</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {events.map((ev) => (
            <li
              key={ev.event_id}
              style={{ background: '#fff', padding: '1rem', borderRadius: 8, marginBottom: '0.75rem' }}
            >
              <strong>{ev.event_id}</strong>
              <div>
                {ev.throughput_per_minute}/min · paused={String(ev.paused)} · bots={ev.bot_protection}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => liveOverride(ev.event_id, { paused: !ev.paused })}>
                  {ev.paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" onClick={() => liveOverride(ev.event_id, { emergency_open: true })}>
                  Open floodgates
                </button>
                <button
                  type="button"
                  onClick={() => liveOverride(ev.event_id, { bot_protection: 'challenge_suspicious' })}
                >
                  Enable CAPTCHA (suspicious)
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
