// The allow-list and the workflows have to agree.
//
// assemble_manifest.py's KNOWN_DOMAINS decides what is allowed to STAY on the
// `data` branch; the DOMAIN/DOMAINS env in each render workflow decides what
// gets COPIED onto it. If a workflow publishes a directory the allow-list has
// never heard of, the publish step deletes it moments after rendering it, and
// the only symptom is a domain quietly missing from the manifest.
//
// That is not hypothetical. `hrrr-dark` — the dark-basemap render of the HRRR
// field — was added to the HRRR workflow and pruned by an allow-list that had
// not been updated with it. The two lists are in different languages in
// different directories, so nothing but a test keeps them in step.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workflowDir = join(here, '..', '..', '.github', 'workflows');

function allowList() {
  const src = readFileSync(join(here, 'assemble_manifest.py'), 'utf8');
  const m = src.match(/^KNOWN_DOMAINS = \(([^)]*)\)/m);
  if (!m) throw new Error('assemble_manifest.py: could not find KNOWN_DOMAINS');
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// Every domain any render workflow copies onto the branch, from its publish step.
function publishedByWorkflows() {
  const out = new Map();
  for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
    const yaml = readFileSync(join(workflowDir, file), 'utf8');
    // DOMAINS wins where both are set — publish.sh defaults DOMAINS to DOMAIN.
    const many = yaml.match(/^\s*DOMAINS:\s*(.+)$/m);
    const one = yaml.match(/^\s*DOMAIN:\s*(\S+)\s*$/m);
    const names = many ? many[1].trim().split(/\s+/) : one ? [one[1]] : [];
    for (const n of names) out.set(n, file);
  }
  return out;
}

describe('published domains and the manifest allow-list', () => {
  it('allows every domain the workflows publish', () => {
    const known = allowList();
    const missing = [...publishedByWorkflows()]
      .filter(([name]) => !known.includes(name))
      .map(([name, file]) => `${name} (published by ${file})`);
    expect(missing, 'add these to KNOWN_DOMAINS or they are deleted at publish time').toEqual([]);
  });

  it('does not allow domains nothing publishes', () => {
    // The reverse drift: a name left behind after a renderer is retired keeps a
    // stale directory alive on the branch forever.
    const published = new Set(publishedByWorkflows().keys());
    const orphans = allowList().filter((n) => !published.has(n));
    expect(orphans, 'nothing writes these — drop them from KNOWN_DOMAINS').toEqual([]);
  });

  it('finds the workflows at all', () => {
    // Guards the two assertions above from passing vacuously if the workflow
    // directory moves or the env keys are renamed.
    expect(publishedByWorkflows().size).toBeGreaterThan(0);
    expect(allowList().length).toBeGreaterThan(0);
  });
});
