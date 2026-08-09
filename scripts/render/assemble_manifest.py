#!/usr/bin/env python3
"""Merge every <domain>/domain.json in the data tree into one root manifest.

Run from the publish step of each render workflow, AFTER that workflow has
dropped its own domain directory into a checkout of the `data` branch. Domains
rendered by other workflows are already sitting there, so the root manifest
always describes everything currently published — no workflow needs to know
what the others produce.

  python scripts/render/assemble_manifest.py <data-dir>

Writes <data-dir>/manifest.json at MANIFEST_VERSION. Bumping that number is a
deliberate break: src/lib/frames.js refuses a version it does not understand
and the map degrades to the point grid, which is the intended failure mode.
"""

import json
import os
import shutil
import sys
from datetime import datetime, timezone

MANIFEST_VERSION = 2

# The domains this project publishes. THE allow-list — a directory on the data
# branch is not a domain unless it is named here.
#
# It exists because "merge whatever is present" plus publish.sh's "preserve
# directories I do not own" makes any published directory immortal, and a
# workflow_dispatch from any branch can add one to production.
#
# It nearly did the opposite kind of damage first. `hrrr-dark` was read as an
# accident and pruned; it is the deliberate dark-basemap render of the HRRR
# field, published at priority 1 so no older client can select it. Which is the
# real lesson: this list is not a guess about what looks unfamiliar, it is a
# statement of what the project publishes, and it has to be updated in the same
# change that adds a renderer. Adding a domain means writing one anyway, so a
# line here costs nothing.
#
# Keep in step with DOMAINS in .github/workflows/*.yml — those say what gets
# copied onto the branch, this says what is allowed to stay.
KNOWN_DOMAINS = ("hrrr", "hrrr-dark", "cams")


def main(root):
    domains = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        block = os.path.join(path, "domain.json")
        if not os.path.isfile(block):
            continue
        if name not in KNOWN_DOMAINS:
            # Removed, not merely skipped. Skipping would keep it off the
            # manifest but leave the frames on the branch forever, and this is
            # the one step in the pipeline that sees the whole tree.
            size = sum(
                os.path.getsize(os.path.join(dirpath, f))
                for dirpath, _, files in os.walk(path)
                for f in files
            )
            print(f"  DROP {name}: not in KNOWN_DOMAINS — removing {size / 1048576:.1f} MB")
            shutil.rmtree(path)
            continue
        with open(block) as f:
            domains.append(json.load(f))

    if not domains:
        raise SystemExit(f"no <domain>/domain.json under {root} — refusing to write an empty manifest")

    # Sharpest first, so a client can take the first match without sorting.
    domains.sort(key=lambda d: -d.get("priority", 0))

    manifest = {
        "version": MANIFEST_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "domains": domains,
    }
    with open(os.path.join(root, "manifest.json"), "w") as f:
        json.dump(manifest, f)

    for d in domains:
        print(f"  {d['id']:8s} {d['resolutionKm']:>4} km  {len(d['frames']):3d} frames  run {d['run']}")
    print(f"manifest v{MANIFEST_VERSION}: {len(domains)} domain(s)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
