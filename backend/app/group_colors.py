"""Hex colours for member groups.

Stored as ``#rrggbb``. New groups pick the next unused palette swatch so a
team's chips don't all land on the same default.
"""

from __future__ import annotations

import re

HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

DEFAULT_GROUP_COLORS = (
    "#d97706",
    "#2563eb",
    "#059669",
    "#dc2626",
    "#7c3aed",
    "#db2777",
    "#0d9488",
    "#ea580c",
)

FALLBACK_GROUP_COLOR = DEFAULT_GROUP_COLORS[0]


class GroupColorError(ValueError):
    """The value is not a six-digit hex colour."""


def normalize_hex(value: str) -> str:
    """Accept ``#RGB``-style six-digit hex, with or without a leading ``#``."""
    cleaned = value.strip()
    if not cleaned.startswith("#") and len(cleaned) == 6:
        cleaned = f"#{cleaned}"
    if not HEX_COLOR_RE.match(cleaned):
        raise GroupColorError("Colour must be a hex value like #d97706.")
    return cleaned.lower()


def resolve_color(value: str | None) -> str:
    """Return a stored colour, or the fallback when a legacy row has none."""
    if not value:
        return FALLBACK_GROUP_COLOR
    try:
        return normalize_hex(value)
    except GroupColorError:
        return FALLBACK_GROUP_COLOR


def pick_default_color(existing: list[str]) -> str:
    """First palette colour the team is not already using, else cycle the list."""
    used = {resolve_color(color) for color in existing}
    for color in DEFAULT_GROUP_COLORS:
        if color not in used:
            return color
    return DEFAULT_GROUP_COLORS[len(existing) % len(DEFAULT_GROUP_COLORS)]
