// src/hooks/useContrastColor.ts

/**
 * Returns a light or dark color token depending on which gives
 * better WCAG contrast against the given background.
 *
 * Accepts: #rgb, #rrggbb, rgb(...), rgba(...) strings.
 */
export function getContrastColor(
  bgColor: string,
  lightColor = '#ffffff',
  darkColor  = '#1a1a1a'
): string {
  let r: number, g: number, b: number;

  const hex = bgColor.trim();

  if (hex.startsWith('#')) {
    const raw  = hex.replace('#', '');
    const full = raw.length === 3
      ? raw.split('').map(c => c + c).join('')
      : raw;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else if (hex.startsWith('rgb')) {
    // handles both rgb(r,g,b) and rgba(r,g,b,a)
    const parts = hex.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return darkColor;
    [r, g, b] = parts.map(Number);
  } else {
    // Named colors or anything else — default to dark text
    return darkColor;
  }

  // WCAG relative luminance
  const linearize = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const L = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

  // L > 0.179 means the background is light enough to need dark text
  return L > 0.179 ? darkColor : lightColor;
}

/**
 * Derives the three text-color tiers (primary / secondary / muted)
 * from a background luminance decision with improved contrast.
 *
 * Drop-in for getSceneTextColors() in App.tsx if you want a single
 * source of truth based on the scene background color.
 */
export function getSceneTextColorsByBg(bgHex: string) {
  const isDark = getContrastColor(bgHex) === '#ffffff';
  return isDark
    ? {
        // Light text on dark background - improved contrast
        t1: '#ffffff',
        t2: '#c8d5e8',
        t3: '#8a9ab0',
        light: false
      }
    : {
        // Dark text on light background
        t1: '#0d1a2a',
        t2: '#384858',
        t3: '#5a6a7a',
        light: true
      };
}

/**
 * Calculate contrast ratio between two colors (WCAG AAA compliant)
 * Returns value between 1 and 21, where higher is better
 */
export function getContrastRatio(color1: string, color2: string): number {
  const getLuminance = (hex: string): number => {
    let r: number, g: number, b: number;

    if (hex.startsWith('#')) {
      const raw = hex.replace('#', '');
      const full = raw.length === 3
        ? raw.split('').map(c => c + c).join('')
        : raw;
      r = parseInt(full.slice(0, 2), 16);
      g = parseInt(full.slice(2, 4), 16);
      b = parseInt(full.slice(4, 6), 16);
    } else if (hex.startsWith('rgb')) {
      const parts = hex.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return 0.5;
      [r, g, b] = parts.map(Number);
    } else {
      return 0.5;
    }

    const linearize = (channel: number) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  };

  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Hook to use contrast-aware colors in React components
 */
export function useContrastColor(bgColor: string, lightColor?: string, darkColor?: string) {
  return getContrastColor(bgColor, lightColor, darkColor);
}

export function useSceneTextColors(bgColor: string) {
  return getSceneTextColorsByBg(bgColor);
}