#!/usr/bin/env python3
"""Compare a .env file with its template (.env.example) before a deploy.

Reports variables that are missing, empty, or not in the template, and values
that still look like placeholders ("changeme", "<...>", "TODO"). It never
prints a value: .env files hold secrets.

Usage:
  env_validator.py .env [--template .env.example] [--allow-extra]

Exit: 0 when it matches the template, 1 otherwise.
"""
import argparse
import pathlib
import re
import sys

PLACEHOLDER = re.compile(r"^(changeme|change-me|todo|xxx+|<.*>|your[_-].*|example.*)$", re.IGNORECASE)


def parse_env(text):
    """Parse KEY=value lines; ignore comments, blank lines and an optional 'export '."""
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = line.removeprefix("export ").strip()
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def compare(env, template, allow_extra=False):
    problems = []
    for key in template:
        if key not in env:
            problems.append(f"missing: {key}")
        elif env[key] == "":
            problems.append(f"empty: {key}")
        elif PLACEHOLDER.match(env[key]):
            problems.append(f"placeholder value: {key}")
    if not allow_extra:
        problems += [f"not in the template: {key}" for key in env if key not in template]
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("env", type=pathlib.Path)
    ap.add_argument("--template", type=pathlib.Path, default=None)
    ap.add_argument("--allow-extra", action="store_true")
    args = ap.parse_args(argv)
    template_path = args.template or args.env.with_name(args.env.name + ".example")
    problems = compare(parse_env(args.env.read_text()), parse_env(template_path.read_text()), args.allow_extra)
    for p in problems:
        print(p)
    print(f"{args.env}: {'OK' if not problems else f'{len(problems)} problem(s)'} against {template_path}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
