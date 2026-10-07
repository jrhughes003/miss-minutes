// The two looks (D33): "terminal" (dark amber phosphor, the default) and
// "office" (light manila paper and beige plastic). The choice is a per-device
// preference, so it lives in localStorage and is applied before React renders
// to avoid a flash of the wrong theme.

export type Theme = 'dark' | 'light'

const KEY = 'miss-minutes:theme'

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark' // storage blocked (private window): the default still works
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // not remembered, but applied for this visit
  }
}
