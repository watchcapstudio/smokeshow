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
import sys
from datetime import datetime, timezone

MANIFEST_VERSION = 2


def main(root):
    domains = []
    for name in sorted(os.listdir(root)):
        block = os.path.join(root, name, "domain.json")
        if not os.path.isfile(block):
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
