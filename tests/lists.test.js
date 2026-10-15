/**
 * Scenario list filtering/search/pagination and chat list labels (R8, #9).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server.js';

let srv, admin, alice, bob;
const list = (token, qs) => srv.request('GET', `/api/scenarios?${qs}`, { token });
const save = (token, over) => srv.request('POST', '/api/scenarios', {
  token,
  body: { id: randomUUID(), name: 'S', description: 'd', tags: [], backstory: 'b', characters: [], lorePieces: [], settings: { isPublic: true }, ...over },
});

before(async () => {
  srv = await startServer();
  admin = await srv.register();
  alice = await srv.register();
  bob = await srv.register();
  // 25 public scenarios by Alice, the oldest one has a unique word
  for (let i = 0; i < 25; i++) {
    await save(alice.token, { name: i === 0 ? 'Zephyrine Keep' : `Public ${i}`, createdAt: 1000 + i });
  }
  await save(alice.token, { name: 'Alice secret', settings: { isPublic: false }, tags: ['hidden-tag'] });
  await save(bob.token, { name: 'Bob secret', settings: { isPublic: false } });
});
after(async () => { await srv?.stop(); });

test('search finds matches beyond the first page', async () => {
  const r = await list(bob.token, 'tab=explore&limit=20&page=1&q=zephyrine');
  assert.equal(r.status, 200);
  assert.equal(r.json.pagination.total, 1);
  assert.equal(r.json.scenarios[0].name, 'Zephyrine Keep');
});

test('tabs are filtered by the server with correct totals', async () => {
  const explore = await list(bob.token, 'tab=explore&limit=20');
  // 25 by Alice + 2 seeded public defaults
  assert.equal(explore.json.pagination.total, 27);
  assert.equal(explore.json.scenarios.length, 20);
  assert.ok(explore.json.scenarios.every(s => s.settings.isPublic === true));

  const minePrivate = await list(alice.token, 'tab=mine-private&limit=20');
  assert.deepEqual(minePrivate.json.scenarios.map(s => s.name), ['Alice secret']);

  const minePublic = await list(alice.token, 'tab=mine-public&limit=20');
  assert.equal(minePublic.json.pagination.total, 25);
});

test('private scenarios never leak to other users, even via search', async () => {
  const r = await list(bob.token, 'q=secret&limit=50');
  assert.deepEqual(r.json.scenarios.map(s => s.name), ['Bob secret']);
  const byTag = await list(bob.token, 'q=hidden-tag');
  assert.equal(byTag.json.pagination.total, 0);
});

test('search treats % and _ literally', async () => {
  const r = await list(bob.token, 'tab=explore&q=%25');
  assert.equal(r.json.pagination.total, 0);
});

test('chat list includes each chat\'s scenario name and cover', async () => {
  const s = await save(bob.token, { name: 'Labelled', image: 'https://images.unsplash.com/photo-x' });
  const scenarioId = s.json.id;
  const chat = { id: randomUUID(), scenarioId, title: 't', messages: [], memories: [], settings: {}, createdAt: Date.now() };
  await srv.request('POST', '/api/chats', { token: bob.token, body: chat });
  const chats = (await srv.request('GET', '/api/chats', { token: bob.token })).json;
  const got = chats.find(c => c.id === chat.id);
  assert.equal(got.scenarioName, 'Labelled');
  assert.equal(got.scenarioImage, 'https://images.unsplash.com/photo-x');
  assert.equal(got.scenarioDeleted, false);
});
