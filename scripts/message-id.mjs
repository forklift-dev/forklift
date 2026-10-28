import { createHash } from 'node:crypto';

const source = process.argv.slice(2).join(' ');
if (!source.trim()) {
  process.stderr.write('Usage: npm run i18n:id -- "English source text"\n');
  process.exit(1);
}
process.stdout.write(`msg.${createHash('sha256').update(source).digest('hex').slice(0, 16)}\n`);
