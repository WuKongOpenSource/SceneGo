fetch('/static/platform-release.json', { cache: 'no-store', credentials: 'omit' })
  .then(response => {
    if (!response.ok) throw new Error('Release metadata unavailable');
    return response.json();
  })
  .then(release => {
    if (typeof release.version !== 'string' || !/^\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/.test(release.version)) return;
    document.querySelectorAll('[data-platform-version]').forEach(element => {
      element.textContent = `v${release.version}`;
      element.setAttribute('aria-label', `平台版本 ${release.version}`);
    });
  })
  .catch(() => {});
