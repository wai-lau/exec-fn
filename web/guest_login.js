// Guest gate is a Cloudflare Turnstile challenge instead of a shared key.
// Turnstile injects the cf-turnstile-response token into the form; this
// data-callback fires on a successful solve and auto-submits, so the visitor
// doesn't also have to press the down-arrow (which stays as a manual fallback,
// e.g. if the auto-submit is blocked).
function onGuestVerified() {
  var f = document.querySelector('form.login-box');
  if (f) f.submit();
}
