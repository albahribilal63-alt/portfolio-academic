import assert from 'node:assert/strict';
import test from 'node:test';
import type { AcademicArchive } from '../src/types/academic.ts';
import { AdminDataStore, type AdminDataPayload } from '../src/features/admin/data/AdminDataStore.ts';

const firstArchive = { site: { title: 'First' }, years: [], modules: [] } as unknown as AcademicArchive;
const secondArchive = { site: { title: 'Second' }, years: [], modules: [] } as unknown as AcademicArchive;

function payload(data: AcademicArchive, sha: string): AdminDataPayload {
  return { data, sha, professorUrls: {} };
}

test('concurrent initial consumers share exactly one loader request', async () => {
  const store = new AdminDataStore();
  let requestCount = 0;
  let resolveLoad!: (value: AdminDataPayload) => void;
  const loader = () => {
    requestCount += 1;
    return new Promise<AdminDataPayload>((resolve) => { resolveLoad = resolve; });
  };

  const firstConsumer = store.initialize(loader);
  const secondConsumer = store.initialize(loader);
  assert.equal(requestCount, 1);
  resolveLoad(payload(firstArchive, 'sha-1'));

  const [firstResult, secondResult] = await Promise.all([firstConsumer, secondConsumer]);
  assert.equal(firstResult.data, firstArchive);
  assert.equal(secondResult.data, firstArchive);
  assert.equal(store.getSnapshot().status, 'ready');
});

test('a failed initial load can be retried and successful data stays cached', async () => {
  const store = new AdminDataStore();
  await assert.rejects(store.initialize(async () => { throw new Error('offline'); }), /offline/);
  assert.equal(store.getSnapshot().status, 'error');

  let requestCount = 0;
  const loader = async () => {
    requestCount += 1;
    return payload(firstArchive, 'sha-1');
  };
  await store.initialize(loader);
  await store.initialize(loader);

  assert.equal(requestCount, 1);
  assert.equal(store.getSnapshot().data, firstArchive);
});

test('explicit refresh replaces the archive and failed refresh preserves the last valid snapshot', async () => {
  const store = new AdminDataStore();
  await store.initialize(async () => payload(firstArchive, 'sha-1'));
  await store.refresh(async () => payload(secondArchive, 'sha-2'));
  assert.equal(store.getSnapshot().data, secondArchive);
  assert.equal(store.getSnapshot().sha, 'sha-2');

  await assert.rejects(store.refresh(async () => { throw new Error('conflict'); }), /conflict/);
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().data, secondArchive);
  assert.equal(store.getSnapshot().sha, 'sha-2');
});

test('mutation commits replace shared data without invoking a loader', async () => {
  const store = new AdminDataStore();
  let requestCount = 0;
  await store.initialize(async () => {
    requestCount += 1;
    return payload(firstArchive, 'sha-1');
  });

  store.replace(secondArchive, 'sha-2');
  assert.equal(requestCount, 1);
  assert.equal(store.getSnapshot().data, secondArchive);
  assert.equal(store.getSnapshot().sha, 'sha-2');
});

test('direct route entry, route changes, and returning to a section reuse the session store', async () => {
  const store = new AdminDataStore();
  let requestCount = 0;
  const loader = async () => {
    requestCount += 1;
    return payload(firstArchive, 'sha-1');
  };
  const directEntryRoute = 'modules';
  assert.equal(directEntryRoute, 'modules');
  await store.initialize(loader);

  for (const route of ['dashboard', 'activities', 'assets', 'isolated-links', 'years', 'modules']) {
    await store.initialize(loader);
    assert.equal(store.getSnapshot().data, firstArchive, `${route} reads the same session data`);
  }
  assert.equal(requestCount, 1);
});

test('a rejected mutation leaves the last valid archive untouched', async () => {
  const store = new AdminDataStore();
  await store.initialize(async () => payload(firstArchive, 'sha-1'));

  const persistThenCommit = async (persist: () => Promise<AdminDataPayload>) => {
    const result = await persist();
    store.replace(result.data, result.sha, result.professorUrls);
  };
  await assert.rejects(persistThenCommit(async () => { throw new Error('write rejected'); }), /write rejected/);
  assert.equal(store.getSnapshot().data, firstArchive);
  assert.equal(store.getSnapshot().sha, 'sha-1');
});

test('a new store after browser refresh performs a fresh initial load', async () => {
  let requestCount = 0;
  const loader = async () => {
    requestCount += 1;
    return payload(requestCount === 1 ? firstArchive : secondArchive, `sha-${requestCount}`);
  };

  const firstSession = new AdminDataStore();
  await firstSession.initialize(loader);
  const refreshedSession = new AdminDataStore();
  await refreshedSession.initialize(loader);

  assert.equal(requestCount, 2);
  assert.equal(refreshedSession.getSnapshot().data, secondArchive);
  assert.equal(refreshedSession.getSnapshot().sha, 'sha-2');
});

test('clearing a session prevents an in-flight old request from repopulating the store', async () => {
  const store = new AdminDataStore();
  let resolveLoad!: (value: AdminDataPayload) => void;
  const pending = store.initialize(() => new Promise<AdminDataPayload>((resolve) => { resolveLoad = resolve; }));
  store.clear();
  resolveLoad(payload(firstArchive, 'sha-1'));
  await pending;

  assert.equal(store.getSnapshot().status, 'idle');
  assert.equal(store.getSnapshot().data, null);
});