#!/usr/bin/env python3

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

# Construct signatures in pieces so the scanner does not detect itself.
GROQ_PREFIX = "gs" + "k_"
GOOGLE_PREFIX = "AI" + "za"
CRON_PREFIX = "shine" + "_secret"

PATTERNS = [
    ("Groq API credential",
     re.compile(re.escape(GROQ_PREFIX) + r"[A-Za-z0-9_-]{20,}")),

    ("Telegram bot token",
     re.compile(r"\b[0-9]{8,12}:[A-Za-z0-9_-]{25,}\b")),

    ("Google API credential",
     re.compile(re.escape(GOOGLE_PREFIX) + r"[0-9A-Za-z_-]{30,}")),

    ("Private key block",
     re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),

    ("Known old cron secret",
     re.compile(re.escape(CRON_PREFIX) + r"[A-Za-z0-9_-]*")),
]

SKIP_DIRS = {
    ".git", "node_modules", ".next", ".venv",
    "__pycache__", "coverage", "out", "build"
}

SKIP_FILES = {
    "package-lock.json",
}

def scan_content(path, content):
    if b"\x00" in content:
        return []

    findings = []

    text = content.decode("utf-8", errors="ignore")

    for line_number, line in enumerate(text.splitlines(), 1):
        for label, pattern in PATTERNS:
            if pattern.search(line):
                findings.append((path, line_number, label))

    return findings


def scan_worktree():
    findings = []

    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for name in files:
            if name in SKIP_FILES:
                continue

            path = Path(root) / name

            try:
                if path.is_symlink():
                    continue

                findings.extend(
                    scan_content(
                        str(path),
                        path.read_bytes()
                    )
                )
            except (OSError, PermissionError):
                continue

    return findings


def scan_staged():
    findings = []

    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "-z"],
        capture_output=True,
        check=True
    )

    paths = [
        item.decode("utf-8", errors="surrogateescape")
        for item in result.stdout.split(b"\0")
        if item
    ]

    for path in paths:
        if Path(path).name in SKIP_FILES:
            continue

        blob = subprocess.run(
            ["git", "show", ":" + path],
            capture_output=True
        )

        if blob.returncode != 0:
            continue

        findings.extend(scan_content(path, blob.stdout))

    return findings


def main():
    parser = argparse.ArgumentParser(
        description="Scan Shine Bot files for exposed credentials."
    )
    parser.add_argument(
        "--staged",
        action="store_true",
        help="Scan Git staged content only."
    )

    args = parser.parse_args()

    try:
        findings = scan_staged() if args.staged else scan_worktree()
    except subprocess.CalledProcessError:
        print("ERROR: Git staged-file scan could not run.")
        return 2

    if findings:
        print("\nSECURITY SCAN FAILED\n")

        for path, line, label in findings:
            print(f"FOUND: {label} at {path}:{line}")

        print(f"\nTotal findings: {len(findings)}")
        print("Remove the exposed values before committing.")
        return 1

    print(
        "SECURITY SCAN PASSED — "
        + ("staged files" if args.staged else "working tree")
        + " contains no detected credentials."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
