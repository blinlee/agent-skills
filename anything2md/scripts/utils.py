#!/usr/bin/env python3
"""Shared filesystem helpers for anything2md decoders."""

from __future__ import annotations

import os
from pathlib import Path


def relative_posix_path(target: Path, start: Path) -> str:
    return os.path.relpath(target.resolve(), start.resolve()).replace(os.sep, "/")
