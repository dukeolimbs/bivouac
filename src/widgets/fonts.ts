/** Bivouac — font choice for the note tile, the meter label and the Cast Bar:
 *  a family Foundry already has, or a Google Font name loaded on demand. */

import { foundryFontFamilies } from "./foundry-api";

/** Families offered in the font dropdowns. Whatever Foundry knows about, or a
 *  small safe set if the probes came back empty. */
export function availableFonts(): string[] {
  const out = new Set(foundryFontFamilies());
  if (out.size === 0) ["Signika", "Arial", "Times New Roman", "Courier New"].forEach((f) => out.add(f));
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Lazily inject a Google Fonts stylesheet for a custom family name (once per
 *  family). Only used for the "custom font" fields — dropdown fonts are already
 *  loaded by Foundry. */
const loadedGoogleFonts = new Set<string>();
export function ensureGoogleFont(family: string): void {
  const name = family.trim();
  if (!name) return;
  const key = name.toLowerCase();
  if (loadedGoogleFonts.has(key)) return;
  loadedGoogleFonts.add(key);
  const id = `bivouac-font-${key.replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

/** The `font-family` a tile applies for a chosen family: the picked or custom
 *  name, then the theme default. Custom names are loaded on demand first. */
export function fontStack(family: string, custom: string): string | null {
  const name = custom || family;
  if (!name) return null;
  if (custom) ensureGoogleFont(custom);
  return `"${name}", var(--font-primary, "Signika", sans-serif)`;
}
