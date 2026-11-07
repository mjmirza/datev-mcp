#!/usr/bin/env python3
"""Blocks a malicious PR. Secrets fail closed; a CI-controlling path
change needs a maintainer-applied 'security-reviewed' label. Adapt
SENSITIVE_PREFIXES to this repo's own CI-controlling paths before use."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SENSITIVE_PREFIXES = (
    ".github/workflows/",
    ".github/dependabot.yml",
    "tools/",
    "scripts/",
    "package.json",
    "package-lock.json",
    ".github/CODEOWNERS",
    ".gitignore",
)
OVERRIDE_LABEL = "security-reviewed"


def run(cmd: list[str], timeout: int = 30) -> tuple[int, str, str]:
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, cwd=ROOT, timeout=timeout, check=False
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)
    return r.returncode, r.stdout, r.stderr


def base_sha() -> str:
    return os.environ.get("BASE_SHA") or "origin/main"


def changed_paths() -> list[str] | None:
    code, out, err = run(["git", "diff", "--name-only", f"{base_sha()}...HEAD"])
    if code != 0:
        print(f"git diff failed, cannot verify this PR: {err}", file=sys.stderr)
        return None
    return [p for p in out.splitlines() if p.strip()]


def sensitive_paths(paths: list[str]) -> list[str]:
    return [p for p in paths if any(p == s or p.startswith(s) for s in SENSITIVE_PREFIXES)]


def has_override_label() -> bool:
    pr = os.environ.get("PR_NUMBER", "")
    if not pr:
        return False
    code, out, _ = run(["gh", "pr", "view", pr, "--json", "labels"], timeout=20)
    if code != 0:
        return False
    try:
        labels = json.loads(out).get("labels", [])
    except json.JSONDecodeError:
        return False
    return any(lbl.get("name") == OVERRIDE_LABEL for lbl in labels)


def gitleaks_scan() -> tuple[bool, str]:
    code, out, err = run(
        ["gitleaks", "detect", "--source", str(ROOT), "--log-opts", f"{base_sha()}..HEAD", "--no-banner"],
        timeout=60,
    )
    if code == 0:
        return True, ""
    if code == 1:
        return False, "gitleaks found a potential secret in this PR's diff"
    return False, f"gitleaks did not run cleanly (exit {code}): {err.strip()[:300]}"


def main() -> int:
    paths = changed_paths()
    if paths is None:
        print("BLOCKED: could not compute this PR's changed files, failing closed")
        return 1
    if not paths:
        print("no changed files, nothing to check")
        return 0

    blocking: list[str] = []
    sensitive = sensitive_paths(paths)
    if sensitive:
        if has_override_label():
            print(f"sensitive path(s) touched but '{OVERRIDE_LABEL}' label present, allowed")
        else:
            blocking.append(
                f"touches CI-controlling path(s) without the '{OVERRIDE_LABEL}' label: "
                + ", ".join(sensitive)
            )

    ok, msg = gitleaks_scan()
    if not ok:
        blocking.append(msg)

    if blocking:
        print("PR SECURITY CHECK FAILED.")
        for b in blocking:
            print(f"  {b}")
        return 1

    print(f"security check clean: {len(paths)} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
