// Structural check on every stylesheet we ship.
//
// Why this exists: on 2026-08-03 a merge resolved a CSS conflict by keeping
// both sides, but the conflict hunk had split a rule in half. The result left
// one rule unclosed, which silently killed every rule after it — including the
// `position: absolute` that put the fire icons on the map. It reached
// production. `npm test` passed. `npm run build` passed, repeatedly: Vite
// concatenates CSS, it does not validate it.
//
// Brace balance is the whole check. It is cheap, it has no dependencies, and
// it catches the exact failure mode that a both-sides merge produces.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src'];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.css')) files.push(p);
  }
})(ROOTS[0]);

// Strip comments and quoted strings so braces inside them never count. A url()
// or a content: "}" is legal CSS and must not read as structure.
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return { out, unterminatedComment: true };
      out += ' '.repeat(end + 2 - i);
      i = end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += ' '.repeat(Math.min(j, src.length - 1) + 1 - i);
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return { out, unterminatedComment: false };
}

const problems = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (src.includes('<<<<<<<') || src.includes('>>>>>>>')) {
    problems.push(`${file}: conflict markers left in the file`);
    continue;
  }
  const { out, unterminatedComment } = strip(src);
  if (unterminatedComment) {
    problems.push(`${file}: unterminated /* comment`);
    continue;
  }
  let depth = 0;
  let line = 1;
  let openedAt = [];
  for (const ch of out) {
    if (ch === '\n') line += 1;
    else if (ch === '{') { depth += 1; openedAt.push(line); }
    else if (ch === '}') {
      depth -= 1;
      openedAt.pop();
      if (depth < 0) { problems.push(`${file}:${line}: stray '}' — closes a block that was never opened`); break; }
    }
  }
  if (depth > 0) {
    problems.push(
      `${file}: ${depth} unclosed block(s); the earliest still open started at line ${openedAt[0]}. ` +
        `Every rule after it is silently dead.`,
    );
  }
}

if (problems.length) {
  console.error('CSS structure check FAILED:\n');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`CSS structure OK — ${files.length} stylesheet(s), all blocks balanced.`);
