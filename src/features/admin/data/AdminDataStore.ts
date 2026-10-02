import type { AcademicArchive } from '../../../types/academic';

export interface AdminDataPayload {
  data: AcademicArchive;
  sha: string;
  professorUrls: Record<string, string>;
}

export interface AdminDataSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: AcademicArchive | null;
  sha: string | null;
  professorUrls: Record<string, string>;
  error: unknown;
  refreshing: boolean;
}

const EMPTY_SNAPSHOT: AdminDataSnapshot = {
  status: 'idle',
  data: null,
  sha: null,
  professorUrls: {},
  error: null,
  refreshing: false,
};

function invokeLoader(loader: () => Promise<AdminDataPayload>) {
  try {
    return Promise.resolve(loader());
  } catch (error) {
    return Promise.reject(error);
  }
}

export class AdminDataStore {
  private snapshot: AdminDataSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private initialLoad: Promise<AdminDataSnapshot> | null = null;
  private refreshLoad: Promise<AdminDataSnapshot> | null = null;
  private generation = 0;

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(loader: () => Promise<AdminDataPayload>) {
    if (this.snapshot.status === 'ready') return Promise.resolve(this.snapshot);
    if (this.initialLoad) return this.initialLoad;

    const generation = this.generation;
    this.publish({ ...EMPTY_SNAPSHOT, status: 'loading' });
    const pendingLoad = invokeLoader(loader).then((payload) => {
      if (generation === this.generation) this.publish(this.readySnapshot(payload));
      return this.snapshot;
    }).catch((error: unknown) => {
      if (generation === this.generation) this.publish({ ...EMPTY_SNAPSHOT, status: 'error', error });
      throw error;
    }).finally(() => {
      if (this.initialLoad === pendingLoad) this.initialLoad = null;
    });

    this.initialLoad = pendingLoad;
    return pendingLoad;
  }

  refresh(loader: () => Promise<AdminDataPayload>) {
    if (this.refreshLoad) return this.refreshLoad;

    const previous = this.snapshot;
    const generation = this.generation;
    this.publish(previous.data
      ? { ...previous, error: null, refreshing: true }
      : { ...EMPTY_SNAPSHOT, status: 'loading', refreshing: true });

    const pendingLoad = invokeLoader(loader).then((payload) => {
      if (generation === this.generation) this.publish(this.readySnapshot(payload));
      return this.snapshot;
    }).catch((error: unknown) => {
      if (generation === this.generation) {
        this.publish(previous.data
          ? { ...previous, error, refreshing: false }
          : { ...EMPTY_SNAPSHOT, status: 'error', error });
      }
      throw error;
    }).finally(() => {
      if (this.refreshLoad === pendingLoad) this.refreshLoad = null;
    });

    this.refreshLoad = pendingLoad;
    return pendingLoad;
  }

  replace(data: AcademicArchive, sha: string, professorUrls?: Record<string, string>) {
    const activeLinkIds = new Set((data.isolatedLinks ?? [])
      .filter((link) => link.status === 'active' && (link.expiresAt === null || Date.parse(link.expiresAt) > Date.now()))
      .map((link) => link.id));
    const updatedUrls = { ...this.snapshot.professorUrls, ...professorUrls };
    const retainedUrls = Object.fromEntries(Object.entries(updatedUrls).filter(([id]) => activeLinkIds.has(id)));
    this.publish({
      ...this.snapshot,
      status: 'ready',
      data,
      sha,
      professorUrls: retainedUrls,
      error: null,
      refreshing: false,
    });
  }

  setProfessorUrls(urls: Record<string, string>) {
    this.publish({ ...this.snapshot, professorUrls: { ...this.snapshot.professorUrls, ...urls } });
  }

  clear() {
    this.generation += 1;
    this.initialLoad = null;
    this.refreshLoad = null;
    this.publish(EMPTY_SNAPSHOT);
  }

  private readySnapshot(payload: AdminDataPayload): AdminDataSnapshot {
    return {
      status: 'ready',
      data: payload.data,
      sha: payload.sha,
      professorUrls: payload.professorUrls,
      error: null,
      refreshing: false,
    };
  }

  private publish(snapshot: AdminDataSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}