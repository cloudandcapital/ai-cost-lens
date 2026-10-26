(() => {
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
})();
