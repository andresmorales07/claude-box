import { test, expect } from '@playwright/test';

test('healthz returns 200 without auth', async ({ request }) => {
  const res = await request.get('/healthz', {
    headers: {}, // Override default auth header
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body).toHaveProperty('uptime');
  expect(body).toHaveProperty('sessions');
});

test('rejects unauthenticated requests', async ({ request }) => {
  const res = await request.get('/api/sessions', {
    headers: { Authorization: '' }, // Override default auth
  });
  expect(res.status()).toBe(401);
});

test('accepts authenticated requests', async ({ request }) => {
  const res = await request.get('/api/sessions');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('creates a session', async ({ request }) => {
  const res = await request.post('/api/sessions', {
    data: { prompt: 'Say hello' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('id');
  expect(body).toHaveProperty('status');
});

test('lists sessions', async ({ request }) => {
  // Create a session first
  await request.post('/api/sessions', {
    data: { prompt: 'Test session' },
  });

  const res = await request.get('/api/sessions');
  expect(res.status()).toBe(200);
  const sessions = await res.json();
  expect(sessions.length).toBeGreaterThan(0);
});

test('gets session details', async ({ request }) => {
  const createRes = await request.post('/api/sessions', {
    data: { prompt: 'Detail test' },
  });
  const { id } = await createRes.json();

  const res = await request.get(`/api/sessions/${id}`);
  expect(res.status()).toBe(200);
  const session = await res.json();
  expect(session.id).toBe(id);
  expect(session).toHaveProperty('messages');
  expect(session).toHaveProperty('status');
});

test('interrupts a session', async ({ request }) => {
  const createRes = await request.post('/api/sessions', {
    data: { prompt: 'Interrupt test' },
  });
  const { id } = await createRes.json();

  const res = await request.delete(`/api/sessions/${id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('interrupted');
});

test('returns 404 for unknown session', async ({ request }) => {
  const res = await request.get('/api/sessions/nonexistent-id');
  expect(res.status()).toBe(404);
});
