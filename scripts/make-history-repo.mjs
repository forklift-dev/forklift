// Generates a repository with a long, branchy history for graph and performance checks:
//   node scripts/make-history-repo.mjs <dir> [commits=50000] [seed=1]
// Uses `git fast-import`, so 100k commits take seconds. Branches fork, merge back and some stay open.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [dir, countArg = '50000', seedArg = '1'] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/make-history-repo.mjs <dir> [commits] [seed]');
  process.exit(1);
}
const total = Number(countArg);
let seed = Number(seedArg);
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

mkdirSync(dir, { recursive: true });
execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });

const lines = [];
let mark = 0;
let time = 1_600_000_000;
const tips = new Map(); // branch → mark
const authors = ['Ada <ada@example.com>', 'Grace <grace@example.com>', 'Linus <linus@example.com>', 'Margaret <margaret@example.com>'];

function commit(branch, parents, message) {
  mark += 1;
  time += 60 + Math.floor(random() * 3600);
  const author = authors[Math.floor(random() * authors.length)];
  const body = `${message}\n`;
  lines.push(`commit refs/heads/${branch}`, `mark :${mark}`, `author ${author} ${time} +0000`, `committer ${author} ${time} +0000`, `data ${Buffer.byteLength(body)}`, body);
  if (parents[0]) lines.push(`from :${parents[0]}`);
  for (const parent of parents.slice(1)) lines.push(`merge :${parent}`);
  const content = `${branch} ${mark}\n`;
  lines.push(`M 644 inline file-${mark % 50}.txt`, `data ${Buffer.byteLength(content)}`, content, '');
  tips.set(branch, mark);
  return mark;
}

commit('main', [], 'Initial commit');
let feature = 0;
while (mark < total) {
  const roll = random();
  const open = [...tips.keys()].filter((b) => b !== 'main');
  if (roll < 0.08 && open.length < 12) {
    feature += 1;
    commit(`feature/${feature}`, [tips.get('main')], `Start feature ${feature}`);
  } else if (roll < 0.14 && open.length) {
    const branch = open[Math.floor(random() * open.length)];
    commit('main', [tips.get('main'), tips.get(branch)], `Merge ${branch}`);
    if (random() < 0.85) tips.delete(branch); // most merged branches are deleted
  } else if (open.length && roll < 0.6) {
    const branch = open[Math.floor(random() * open.length)];
    commit(branch, [tips.get(branch)], `Work on ${branch}`);
  } else {
    commit('main', [tips.get('main')], `Change ${mark}`);
  }
}
// Deleted branches still need a ref while importing; fast-import only writes the final tips listed.
lines.push('');
execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: lines.join('\n'), maxBuffer: 1 << 30 });
// Remove refs of branches that were "deleted" after merging.
const refs = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/feature'], { cwd: dir }).toString().split('\n').filter(Boolean);
for (const ref of refs) if (!tips.has(ref)) execFileSync('git', ['branch', '-q', '-D', ref], { cwd: dir });
execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });
console.log(`${dir}: ${mark} commits, ${tips.size} branches`);
