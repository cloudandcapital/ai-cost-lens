export const THEME_STORAGE_KEY = 'cc-color-mode-v1';
const LEGACY_KEY = 'cc-renewal-color-mode-v1';
const valid = value => value === 'light' || value === 'dark';

export function savedColorMode(view) {
  let cookie;
  try { cookie = view.document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('cc-color-mode='))?.slice(14); } catch {}
  if (valid(cookie)) return cookie;
  try {
    const saved = view.localStorage.getItem(THEME_STORAGE_KEY);
    if (valid(saved)) return saved;
    const legacy = view.localStorage.getItem(LEGACY_KEY);
    if (valid(legacy)) return legacy;
  } catch {}
  return 'light';
}

export function initialColorMode(view) {
  const requested = new URL(view.location.href).searchParams.get('theme');
  return valid(requested) ? requested : savedColorMode(view);
}

export function startColorMode(root) {
  if (!root || root.dataset.colorModeReady) return () => {};
  const buttons = [...root.querySelectorAll('[data-theme-toggle]')];
  if (!buttons.length) return () => {};
  const view = root.ownerDocument.defaultView;
  let mode = initialColorMode(view);
  root.dataset.colorModeReady = 'true';
  function render() {
    root.dataset.colorMode = mode;
    for (const button of buttons) {
      const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.hidden = false;
    }
    root.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#211F1D' : '#F5EEE9');
  }
  function toggle() {
    mode = mode === 'dark' ? 'light' : 'dark';
    try { view.localStorage.setItem(THEME_STORAGE_KEY, mode); } catch {}
    try {
      const host = view.location.hostname;
      const domain = host === 'cloudandcapital.com' || host.endsWith('.cloudandcapital.com') ? '; Domain=cloudandcapital.com' : '';
      const secure = view.location.protocol === 'https:' ? '; Secure' : '';
      root.ownerDocument.cookie = `cc-color-mode=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${secure}${domain}`;
    } catch {}
    const url = new URL(view.location.href);
    if (url.searchParams.has('theme')) {
      url.searchParams.set('theme', mode);
      view.history.replaceState(view.history.state, '', url);
    }
    render();
  }
  function sync(event) {
    if (event.type === 'storage' && event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    mode = initialColorMode(view);
    render();
  }
  buttons.forEach(button => button.addEventListener('click', toggle));
  view.addEventListener('storage', sync);
  view.addEventListener('pageshow', sync);
  render();
  return () => {
    buttons.forEach(button => button.removeEventListener('click', toggle));
    view.removeEventListener('storage', sync);
    view.removeEventListener('pageshow', sync);
    delete root.dataset.colorModeReady;
  };
}

// Runs in the head before the page is painted. No device-theme inference or storage writes.
export const themeBootstrap = `(() => {
  let mode = 'light';
  const valid = value => value === 'light' || value === 'dark';
  try {
    const requested = new URL(location.href).searchParams.get('theme');
    const cookie = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('cc-color-mode='))?.slice(14);
    let saved;
    try { const current = localStorage.getItem('cc-color-mode-v1'); saved = valid(current) ? current : localStorage.getItem('cc-renewal-color-mode-v1'); } catch {}
    mode = valid(requested) ? requested : valid(cookie) ? cookie : valid(saved) ? saved : 'light';
  } catch {}
  document.documentElement.dataset.colorMode = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#211F1D' : '#F5EEE9');
})();`;
