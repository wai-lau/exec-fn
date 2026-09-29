// noodle's COMMIT: why the button is off (ndvWhyNot), whether anything is
// unsaved (ndvDirty), the button + its lines (ndvSyncSubmit), the signed
// submit itself -- a rekey, then pending host settings, then the vote, each
// strictly newer -- and the "approved by" stamp. Same global scope as
// noodle-vote.js; loaded before it, called once it has run.

// Why submit cannot be pressed right now, or '' when it can. A disabled
// button with no reason reads as broken.
function ndvWhyNot() {
  var raw = ndv$('nd-name').value;
  if (!raw.trim()) return 'enter your name first';
  if (!window.noodleNormName(raw)) return 'that name is too long, or has characters that cannot be used';
  if (NDV.blocked) return '"' + NDV.blocked + '" is already sealed with a different passphrase';
  if (NDV.taken) return '"' + NDV.taken + '" is already taken';
  if (NDV.keyError) return 'this browser could not make a key';
  if (!ndvReady()) return 'making your key...';
  // the host's picks ARE the offer: committing none would leave guests nothing
  if (window.ndxIsHost && window.ndxIsHost() && NDV.cal && !NDV.cal.getSel().size) {
    return 'pick at least one available time, guests can only pick from yours';
  }
  return '';
}

// Unsaved = the calendar differs from what the server holds for THIS key
// (nothing, for someone who has not committed yet).
function ndvDirty() {
  if (!NDV.cal) return false;
  if (NDV.pendingHalves != null) return true;   // an unsaved split
  if (NDV.pendingCrop !== undefined) return true;   // an unsaved crop
  if (NDV.pendingTitle !== undefined) return true;  // an unsaved title
  if (NDV.pendingNote !== undefined) return true;   // an unsaved note
  if (window.NDR && NDR.active) return true;    // an unsaved new name or passphrase
  var sel = NDV.cal.getSel(), saved = NDV.saved;
  if (sel.size !== saved.size) return true;
  for (var s of sel) if (!saved.has(s)) return true;
  return false;
}

function ndvSyncSubmit(busy) {
  var why = busy ? 'committing...' : ndvWhyNot(), dirty = ndvDirty();
  var btn = ndv$('nd-submit');
  btn.disabled = !!why;
  btn.textContent = dirty ? 'Commit*' : 'Commit';
  btn.classList.toggle('dirty', dirty);   // yellow: there is something to commit
  btn.classList.toggle('clean', !dirty);  // dark: nothing new to commit
  // unsaved -> "* unsaved changes"; nothing unsaved on a committed vote ->
  // "all changes saved"; nothing committed yet -> no line at all
  var el = ndv$('nd-dirty');
  el.hidden = !dirty && !NDV.mine;
  el.textContent = dirty ? '* unsaved changes' : 'all changes saved';
  el.classList.toggle('saved', !dirty);
  ndv$('nd-why').textContent = why;
  ndvSyncLock();
  if (window.ndrSync) window.ndrSync();
}

function ndvApproved(seal, name, copied) {
  var ov = ndv$('nd-approved');
  ov.querySelector('.nd-approved-by').textContent = 'approved by ' + name;
  ov.querySelector('.nd-approved-note').hidden = !copied;
  window.NoodleSeal.paint(ov.querySelector('.nd-seal'), seal);
  ov.hidden = false;
  ov.classList.remove('show');
  void ov.offsetWidth;
  ov.classList.add('show');
  setTimeout(function () { ov.hidden = true; ov.classList.remove('show'); }, 2200);
}

async function ndvSubmit() {
  if (ndvWhyNot()) return;
  // the HOST's commit copies the poll's link for sending. Started HERE, in the
  // tap itself: Safari refuses a clipboard write that comes after the awaits
  // below (the tap's permission has lapsed by then)
  var copying = window.ndxIsHost && window.ndxIsHost() && navigator.clipboard
    ? navigator.clipboard.writeText(location.origin + '/noodle/' + NDV.slug).then(function () { return true; },
      function () { return false; })
    : Promise.resolve(false);
  ndvSyncSubmit(true);
  var name = ndv$('nd-name').value, slots = Array.from(NDV.cal.getSel()).sort();
  var ts = Date.now() + NDV.skew;
  try {
    // a new name/passphrase first (the rest is signed by it), then a pending
    // split/crop (it converts every stored vote); each request is signed
    // strictly newer, as the server's replay check demands
    var rk = await ndrCommit(ts);
    if (!rk.ok) { ndvStatus(rk.data.error || 'could not make the change', 'err'); await ndvLoadPoll(); return; }
    if (rk.did) ts += 1;
    var set = await ndhCommitSettings(ts);
    if (!set.ok) { ndvStatus(set.data.error || 'could not save the split, crop or title', 'err'); await ndvLoadPoll(); return; }
    if (set.sent) ts += 1;
    // keys written in sorted order: the same bytes noodle/sig.py canonical() builds
    var text = JSON.stringify({ name: name, poll: NDV.slug, slots: slots, ts: ts });
    // (every failure above reloads the poll: a refusal usually means someone
    // else changed it -- took the host role, moved the crop -- and the page
    // must show that rather than let the same Commit fail again)
    var sig = await NDV.kdf.sign(text);
    var res = await ndvPost('/vote', { name: name, pub: NDV.kdf.pub(), slots: slots, ts: ts, sig: sig });
    if (!res.ok) { ndvStatus(res.data.error || 'could not commit', 'err'); await ndvLoadPoll(); return; }
    ndvClearDraft();
    if (NDV.draft) {   // the poll exists now: its plain link is the one to keep
      NDV.draft = '';
      history.replaceState(null, '', '/noodle/' + NDV.slug);
    }
    ndvTeach('', NDV_SIGN_DONE);
    // never let the clipboard hold a commit up: some browsers leave the write
    // pending forever (no focus, no permission) -- 800ms, then carry on
    var copied = await Promise.race([copying, new Promise(function (r) { setTimeout(r, 800, false); })]);
    ndvApproved(NDV.seal, window.noodleNormName(name), copied);
    await ndvLoadPoll();
    ndvStatus('committed.');   // (clears a stale error)
    NDV.committed = (NDV.committed || 0) + 1;   // tests wait on this
  } catch (e) {
    ndvStatus('could not commit: ' + e.message, 'err');
  } finally {
    ndvSyncSubmit();
  }
}
