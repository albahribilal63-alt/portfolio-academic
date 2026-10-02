import type { GithubStatusResponse } from './api';

export type AdminAuthState =
  | { status: 'checking' }
  | { status: 'unauthenticated'; message?: string }
  | { status: 'authenticating' }
  | { status: 'authenticated'; adminEmail: string; developmentBypass: false }
  | { status: 'local-development'; developmentBypass: true }
  | { status: 'session-error'; message: string };

export type GithubConnectionState =
  | { status: 'loading' }
  | { status: 'connected'; details: GithubStatusResponse }
  | { status: 'error'; message: string };

export type DataFileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; path: string; branch: string; sha: string }
  | { status: 'error'; message: string };