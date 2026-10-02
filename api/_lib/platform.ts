import type { IncomingMessage, ServerResponse } from 'node:http';

export interface VercelRequest extends IncomingMessage {
  body?: unknown;
}

export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(payload: unknown): VercelResponse;
}