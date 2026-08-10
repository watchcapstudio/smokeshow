# Deploys

Vercel, from `main`. Merging to `main` is the production deploy; there is no
separate release step.

## The ignored build step lives in `vercel.json`, not the dashboard

`vercel.json` sets:

```json
"ignoreCommand": "if [ \"$VERCEL_GIT_COMMIT_REF\" = \"data\" ]; then exit 0; else exit 1; fi"
```

Exit 0 means "ignore this build". Exit 1 means "build it". So the `data` branch
is skipped and every other ref builds.

**Why it is here and not in Project Settings.** The `data` branch is rewritten
four times a day by the HRRR and CAMS render jobs (`.github/workflows/hrrr.yml`,
`cams.yml`). Each of those pushes triggered a Vercel deployment that had no
reason to exist, and they failed, which made the project's deployment list read
as broken when nothing was.

On 2026-08-10 an Ignored Build Step was added in the dashboard to fix that, as:

```
bash if [ "$VERCEL_GIT_COMMIT_REF" = "data" ]; then exit 0; else exit 1; fi
```

The leading `bash` is the bug. Vercel runs the command under `/bin/sh -c`, which
parses `bash if [ ... ]` as a command followed by a stray `then`, so it died with
`syntax error near unexpected token 'then'` and exited 2. A non-zero exit is
supposed to mean "build it", but a *crashed* ignore step fails the whole
deployment instead, so every deploy from every branch errored, for four commits,
until this file took over.

`vercel.json` overrides the dashboard setting, which is the reason it is the
better home for this: it is version-controlled, it is reviewable in a diff, and a
typo in it fails CI-adjacent review rather than silently bricking deploys for
everyone. **If you need to change which branches deploy, change it here.** A
dashboard edit will be ignored while this key exists, which is a trap worth
knowing about if you are staring at Project Settings wondering why it has no
effect.

## Deploy failures that are not the code

Two things look like build failures and are not:

- **`data` branch deployments.** Now skipped by the rule above. Before it, they
  errored because the branch carries published frames and no application.
- **A crashed ignore step.** See above. The tell is a build log that ends at
  `Running "<your ignore command>"` with nothing after it: the build never
  started, so no amount of reading the application code will explain it.

## What CI covers before a deploy

`.github/workflows/ci.yml` runs on every push and PR: web tests, `lint:css`,
`npm run build`, the browser pixel checks (`verify:sky`, `verify:map`,
`verify:fires`), a regeneration check on the Apple tokens and fixtures, and the
Apple builds. Vercel's build is a separate execution of `npm run build`, so a
green CI does not prove a green deploy when the failure is in deploy
configuration rather than in the code.
