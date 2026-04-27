(function () {
  // Monkey-patch AudioContext so we can resume all instances on first touch
  // and after returning from background (iOS suspends on backgrounding).
  var _AC = window.AudioContext || window.webkitAudioContext;
  if (!_AC) return;
  window._waiOrigAC = _AC;
  window._waiAudioContexts = [];
  function PatchedAC() {
    var ctx = new _AC();
    window._waiAudioContexts.push(ctx);
    return ctx;
  }
  PatchedAC.prototype = _AC.prototype;
  window.AudioContext = window.webkitAudioContext = PatchedAC;

  function unlockAll() {
    window._waiAudioContexts.forEach(function(ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(function(){});
    });
  }
  document.addEventListener('touchstart', unlockAll, {once: true, passive: true});
  document.addEventListener('touchend',   unlockAll, {once: true, passive: true});
  document.addEventListener('click',      unlockAll, {once: true});
})();
