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

## The `data` branch needs its own copy of that rule

**Vercel reads the ignore step from the vercel.json on the branch being pushed.**
That is the correction to what this file said first, which was that the rule above
fixed the `data` branch. It did not. `data` carries published frames and nothing
else — no application, and no `vercel.json` — so pushes to it fell through to the
dashboard's Ignored Build Step, which is the broken one, and kept erroring four
times a day while main deployed cleanly.

Two things now cover it, deliberately belt and braces, because the failure mode is
silent and only visible in a deployment list nobody watches:

1. `scripts/render/publish.sh` writes a minimal `vercel.json` carrying
   `"ignoreCommand": "exit 0"` into the tree on every publish. `exit 0` means
   "ignore this build", unconditionally: on that branch no build is ever wanted.
   Written every time rather than committed once, because the branch is
   force-pushed as a fresh orphan.
2. `git.deploymentEnabled: { "data": false }` in main's `vercel.json`. If Vercel
   evaluates that from the production branch, no deployment is created for `data`
   at all, which is cleaner than creating one and skipping it. If it evaluates it
   from the pushed branch, this is a no-op and (1) does the work. The docs do not
   say which, so both are in.

## A merge to `main` that creates no deployment at all

The two failures above produce a deployment that goes red. This one produces no
deployment. It is a different tell and it sends you looking in the wrong place,
because the instinct on "the site is stale" is to blame a cache.

On 2026-08-12, #60 merged to `main` as `42683b8` at 15:49Z. CI was green,
`vercel.json` was correct, and Settings > Git still showed the repository
connected. Five minutes later the deployment list had nothing newer than a
`data` branch build from 15:43Z: no production build, no preview build, no
errored build, no row of any kind. Production went on serving `9c21863` (#59),
which had deployed normally about twenty minutes earlier. Nothing was
misconfigured and nothing was broken. The push event simply did not produce a
deployment.

**How to tell it apart from a cache.** Look at the deployment list before you
look at the browser. If the newest production deployment names an older commit
than `git rev-parse origin/main`, no amount of hard-refreshing or incognito will
help, because the build does not exist. The deployment detail page will also
still show the old commit as "Ready / Latest / Production Current".

**The trap on the way to fixing it.** Redeploy on the last good deployment does
not help. It rebuilds *that deployment's* commit, so you get another build of the
commit that is already live. If you use it, read the commit named in the modal
before confirming.

**The recovery.** Settings > Git > Deploy Hooks, create a hook against `main`,
and POST to it:

```
curl -X POST "https://api.vercel.com/v1/integrations/deploy/<projectId>/<token>"
```

It returns a `job` object and builds whatever `main` currently points at, which
is the merge that was missed. A browser visit will not do it: the hook only
answers POST. Deployments created this way carry `deployHookName` in their
metadata, so they are identifiable in the list afterwards.

Delete the hook once it has served its purpose, and make a fresh one next time.
The URL is a bearer credential: anyone holding it can trigger production builds
of `main`. It cannot deploy arbitrary code, only what is already on the branch,
which is why this is a cleanup step rather than an emergency.

No standing hook is kept for this reason. The one used on 2026-08-12 was revoked
the same day.

## Deploy failures that are not the code

- **A crashed ignore step.** The tell is a build log that ends at
  `Running "<your ignore command>"` with nothing after it: the build never
  started, so no amount of reading the application code will explain it. A
  *non-zero* exit means "build it"; a *crash* fails the deployment.
- **`data` branch deployments**, until (1) above has run at least once. The branch
  is only rewritten when the render jobs fire, so the fix lands on the next
  scheduled run rather than at merge.
- **A push that produced no deployment**, per the section above. The tell is an
  empty deployment list rather than a red one, and the fix is a deploy hook.

## What CI covers before a deploy

`.github/workflows/ci.yml` runs on every push and PR: web tests, `lint:css`,
`npm run build`, the browser pixel checks (`verify:sky`, `verify:map`,
`verify:fires`), a regeneration check on the Apple tokens and fixtures, and the
Apple builds. Vercel's build is a separate execution of `npm run build`, so a
green CI does not prove a green deploy when the failure is in deploy
configuration rather than in the code.
