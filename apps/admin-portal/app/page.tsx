'use client';

import { useEffect, useState } from 'react';

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

export default function AdminHome() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [throughput, setThroughput] = useState(100);
  const [message, setMessage] = useState('');

  async function refresh() {
    const [c, e] = await Promise.all([
      fetch(`${API}/v1/capabilities`).then((r) => r.json()),
      fetch(`${API}/v1/events`).then((r) => r.json()),
    ]);
    setCaps(c);
    setEvents(e);
  }

  useEffect(() => {
    refresh().catch((err) => setMessage(String(err)));
  }, []);

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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) setMessage(await res.text());
    else {
      setMessage('Updated');
      await refresh();
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '3rem 1.25rem' }}>
      <h1 style={{ fontSize: '2.4rem', letterSpacing: '-0.03em', marginBottom: '0.25rem' }}>Vazue Queue</h1>
      <p style={{ color: '#5c5c5c', marginTop: 0 }}>Owner admin — rooms, events, live controls</p>

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
