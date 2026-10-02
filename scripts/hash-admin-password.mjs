import { createAdminPasswordHash } from '../api/_lib/admin-auth.ts';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

let password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
try {
  process.stdout.write(`${createAdminPasswordHash(password)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to create the password hash.');
  process.exitCode = 1;
} finally {
  for (const chunk of chunks) chunk.fill(0);
  password = '';
}