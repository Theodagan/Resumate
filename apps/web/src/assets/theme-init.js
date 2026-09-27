// Applies the saved theme before Angular boots to avoid a dark-to-light flash.
// Kept as a same-origin file (not inline) so the CSP can use script-src 'self'.
try {
  var theme = localStorage.getItem('resumate:theme');
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
} catch (_) {}
