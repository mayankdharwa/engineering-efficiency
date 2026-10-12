const HEX_COLOR = /^#([0-9a-fA-F]{6})$/

/** True when ``value`` is a six-digit hex colour, with or without ``#``. */
export function isHexColor(value: string | null | undefined): boolean {
  if (!value) return false
  return HEX_COLOR.test(normalizeHexInput(value))
}

/** Canonical ``#rrggbb`` form, or null when the value is not a hex colour. */
export function parseHexColor(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = normalizeHexInput(value)
  return HEX_COLOR.test(normalized) ? normalized.toLowerCase() : null
}

/** Black or white text that stays readable on ``hex`` fills. */
export function contrastText(hex: string): string {
  const parsed = parseHexColor(hex)
  if (!parsed) return '#ffffff'
  const r = Number.parseInt(parsed.slice(1, 3), 16) / 255
  const g = Number.parseInt(parsed.slice(3, 5), 16) / 255
  const b = Number.parseInt(parsed.slice(5, 7), 16) / 255
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
  return luminance > 0.55 ? '#1a1a1a' : '#ffffff'
}

function normalizeHexInput(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

function srgb(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}