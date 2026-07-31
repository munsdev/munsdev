// Served at GET /client.js and embedded in Webflow via a single
// <script src="https://api.reflectingpool.us/client.js"></script>
// (Site Settings > Custom Code, or on just the status page).
//
// Wires up three attributes in the Webflow markup:
//   data-poolman-login  - the one login/logout button
//   data-poolman-add    - the "new entry" button
//   data-poolman-edit   - an edit button inside each CMS Collection List
//                          item, with its value bound (via Webflow's own
//                          dynamic-data binding) to that item's Slug field
//
// Everything else -- the modal, the rich text field, the confirm step --
// is built by this script at runtime. Modal styling is intentionally
// minimal inline CSS meant to be replaced once real site CSS is handed
// over; swap the STYLE string below.

export const CLIENT_JS = String.raw`
(function () {
  var scriptEl = document.currentScript;
  var API_BASE = new URL(scriptEl.src).origin;

  var LOGIN_ATTR = 'data-poolman-login';
  var ADD_ATTR = 'data-poolman-add';
  var EDIT_ATTR = 'data-poolman-edit';

  var loggedIn = false;
  var protectedEls = []; // { el, parent, next }

  function apiFetch(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    return fetch(API_BASE + path, opts);
  }

  function collectProtected() {
    protectedEls = [];
    document.querySelectorAll('[' + ADD_ATTR + '], [' + EDIT_ATTR + ']').forEach(function (el) {
      protectedEls.push({ el: el, parent: el.parentNode, next: el.nextSibling, inDom: true });
    });
  }

  function applyVisibility() {
    protectedEls.forEach(function (entry) {
      if (loggedIn && !entry.inDom) {
        entry.parent.insertBefore(entry.el, entry.next);
        entry.inDom = true;
      } else if (!loggedIn && entry.inDom) {
        entry.el.remove();
        entry.inDom = false;
      }
    });
  }

  function setLoggedIn(value) {
    loggedIn = value;
    applyVisibility();
    document.querySelectorAll('[' + LOGIN_ATTR + ']').forEach(function (btn) {
      btn.textContent = loggedIn ? 'Log Out' : 'Log In';
    });
  }

  function checkSession() {
    return apiFetch('/session').then(function (res) {
      return res.json();
    }).then(function (data) {
      setLoggedIn(!!data.loggedIn);
    }).catch(function () {
      setLoggedIn(false);
    });
  }

  // ---- minimal modal shell (shared by login + entry forms) ----
  //
  // Deliberately no backdrop-click-to-close: the only way out is the
  // explicit close (x) button, which -- if the modal was marked dirty --
  // asks Keep editing / Discard before actually closing. This avoids
  // losing in-progress edits to a stray click.

  var overlay, modalBody;

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-poolman-overlay', '');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:9999;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:8px;padding:24px;max-width:420px;width:90%;max-height:85vh;overflow:auto;font-family:sans-serif;position:relative;';
    modalBody = document.createElement('div');
    box.appendChild(modalBody);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function openModal(contentEl) {
    ensureModal();
    modalBody.innerHTML = '';
    modalBody.appendChild(contentEl);
    overlay.style.display = 'flex';
  }

  function closeModal() {
    if (overlay) overlay.style.display = 'none';
  }

  // Call from a modal's close button. isDirtyFn, if given, is called at
  // click time; if it returns true the user is asked to confirm before the
  // modal actually closes.
  function requestClose(isDirtyFn) {
    if (isDirtyFn && isDirtyFn() && !confirm('Discard your changes?')) return;
    closeModal();
  }

  function addCloseButton(wrap, isDirtyFn) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close');
    btn.textContent = '×';
    btn.style.cssText = 'position:absolute;top:8px;right:8px;width:28px;height:28px;line-height:28px;padding:0;border:none;background:transparent;font-size:20px;cursor:pointer;';
    btn.addEventListener('click', function () {
      requestClose(isDirtyFn);
    });
    wrap.appendChild(btn);
  }

  // ---- login modal ----

  function openLoginModal() {
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<h3 style="margin-top:0">Log In</h3>' +
      '<label style="display:block;margin-bottom:8px">Username<br>' +
      '<input type="text" data-f="username" style="width:100%;padding:6px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:12px">Password<br>' +
      '<input type="password" data-f="password" style="width:100%;padding:6px;box-sizing:border-box"></label>' +
      '<div data-f="error" style="color:#b00020;margin-bottom:8px;display:none"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" data-a="submit">Log In</button>' +
      '</div>';
    addCloseButton(wrap, null);

    var errorEl = wrap.querySelector('[data-f="error"]');
    wrap.querySelector('[data-a="submit"]').addEventListener('click', function () {
      var username = wrap.querySelector('[data-f="username"]').value;
      var password = wrap.querySelector('[data-f="password"]').value;
      apiFetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      }).then(function (res) {
        if (!res.ok) throw new Error('bad credentials');
        return res.json();
      }).then(function () {
        closeModal();
        return checkSession();
      }).catch(function () {
        errorEl.textContent = 'Wrong username or password.';
        errorEl.style.display = 'block';
      });
    });

    openModal(wrap);
  }

  function logout() {
    apiFetch('/logout', { method: 'POST' }).finally(checkSession);
  }

  // ---- entry (add / edit) modal ----

  function toLocalInputValue(iso) {
    var d = iso ? new Date(iso) : new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var RICHTEXT_COMMANDS = [
    { cmd: 'bold', label: 'B', style: 'font-weight:bold' },
    { cmd: 'italic', label: 'I', style: 'font-style:italic' },
    { cmd: 'underline', label: 'U', style: 'text-decoration:underline' },
    { cmd: 'formatBlock:h2', label: 'H2', style: '' },
    { cmd: 'formatBlock:p', label: 'P', style: '' },
    { cmd: 'insertUnorderedList', label: '• List', style: '' },
    { cmd: 'insertOrderedList', label: '1. List', style: '' },
    { cmd: 'createLink', label: 'Link', style: '' },
    { cmd: 'removeFormat', label: 'Clear', style: '' },
  ];

  function buildEntryForm(mode, itemId, existing) {
    var dirty = false;
    var markDirty = function () { dirty = true; };

    var wrap = document.createElement('div');
    var existingPhotoHtml = existing && existing.photoUrl
      ? '<img data-f="photo-preview" src="' + existing.photoUrl + '" style="max-width:100%;max-height:160px;display:block;margin-bottom:6px">' +
        '<div style="font-size:12px;color:#666;margin-bottom:6px">Current photo &mdash; choose a new file below to replace it, or leave blank to keep it.</div>'
      : '<img data-f="photo-preview" style="max-width:100%;max-height:160px;display:none;margin-bottom:6px">';

    wrap.innerHTML =
      '<h3 style="margin-top:0">' + (mode === 'edit' ? 'Edit Update' : 'New Update') + '</h3>' +
      '<label style="display:block;margin-bottom:4px">Photo</label>' +
      existingPhotoHtml +
      '<input type="file" accept="image/*" data-f="photo" style="margin-bottom:12px">' +
      '<label style="display:block;margin-bottom:8px;margin-top:8px">Date &amp; Time<br>' +
      '<input type="datetime-local" data-f="date" style="width:100%;padding:6px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:4px">Status</label>' +
      '<div style="margin-bottom:4px;display:flex;flex-wrap:wrap;gap:4px">' +
      RICHTEXT_COMMANDS.map(function (c) {
        return '<button type="button" data-cmd="' + c.cmd + '" style="' + c.style + ';padding:4px 8px;border:1px solid #ccc;border-radius:4px;background:#fafafa;cursor:pointer">' + c.label + '</button>';
      }).join(' ') +
      '</div>' +
      '<div data-f="status" contenteditable="true" style="border:1px solid #ccc;min-height:120px;padding:8px;margin-bottom:12px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" data-a="review">Next</button>' +
      '</div>';
    addCloseButton(wrap, function () { return dirty; });

    wrap.querySelectorAll('[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-cmd');
        wrap.querySelector('[data-f="status"]').focus();
        if (cmd === 'formatBlock:h2') {
          document.execCommand('formatBlock', false, 'h2');
        } else if (cmd === 'formatBlock:p') {
          document.execCommand('formatBlock', false, 'p');
        } else if (cmd === 'createLink') {
          var url = prompt('Link URL:');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(cmd);
        }
        markDirty();
      });
    });

    var dateInput = wrap.querySelector('[data-f="date"]');
    dateInput.value = toLocalInputValue(existing && existing.date);
    dateInput.addEventListener('input', markDirty);
    if (existing && existing.status) {
      wrap.querySelector('[data-f="status"]').innerHTML = existing.status;
    }
    wrap.querySelector('[data-f="status"]').addEventListener('input', markDirty);

    var photoInput = wrap.querySelector('[data-f="photo"]');
    var photoPreview = wrap.querySelector('[data-f="photo-preview"]');
    photoInput.addEventListener('change', function () {
      markDirty();
      var file = photoInput.files[0];
      if (file) {
        photoPreview.src = URL.createObjectURL(file);
        photoPreview.style.display = 'block';
      }
    });

    wrap.querySelector('[data-a="review"]').addEventListener('click', function () {
      var photoFile = photoInput.files[0] || null;
      var dateValue = new Date(dateInput.value).toISOString();
      var statusHtml = wrap.querySelector('[data-f="status"]').innerHTML;
      openConfirm(mode, itemId, { photoFile: photoFile, date: dateValue, status: statusHtml, existingPhotoUrl: existing && existing.photoUrl });
    });

    openModal(wrap);
  }

  function openConfirm(mode, itemId, entry) {
    var wrap = document.createElement('div');
    var photoPreviewHtml = '';
    var previewUrl = entry.photoFile ? URL.createObjectURL(entry.photoFile) : entry.existingPhotoUrl;
    if (previewUrl) {
      photoPreviewHtml = '<img src="' + previewUrl + '" style="max-width:100%;max-height:200px;display:block;margin-bottom:8px">';
    }
    wrap.innerHTML =
      '<h3 style="margin-top:0">Confirm</h3>' +
      photoPreviewHtml +
      '<p><strong>' + new Date(entry.date).toLocaleString() + '</strong></p>' +
      '<div style="border:1px solid #eee;padding:8px;margin-bottom:12px">' + entry.status + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" data-a="back">Back</button>' +
      '<button type="button" data-a="confirm">Post</button>' +
      '</div>';
    addCloseButton(wrap, function () { return true; });

    wrap.querySelector('[data-a="back"]').addEventListener('click', function () {
      buildEntryForm(mode, itemId, { date: entry.date, status: entry.status, photoUrl: entry.existingPhotoUrl });
    });

    wrap.querySelector('[data-a="confirm"]').addEventListener('click', function () {
      var confirmBtn = wrap.querySelector('[data-a="confirm"]');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Posting...';

      var form = new FormData();
      form.append('date', entry.date);
      form.append('status', entry.status);
      if (entry.photoFile) form.append('photo', entry.photoFile);

      var path = mode === 'edit' ? '/submit/' + encodeURIComponent(itemId) : '/submit';
      var method = mode === 'edit' ? 'PATCH' : 'POST';

      apiFetch(path, { method: method, body: form }).then(function (res) {
        if (!res.ok) throw new Error('submit failed');
        return res.json();
      }).then(function () {
        closeModal();
      }).catch(function () {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Post';
        alert('Something went wrong posting that update. Please try again.');
      });
    });

    openModal(wrap);
  }

  function openAddModal() {
    buildEntryForm('add', null, null);
  }

  function openEditModal(itemId) {
    apiFetch('/item/' + encodeURIComponent(itemId)).then(function (res) {
      return res.json();
    }).then(function (item) {
      var fieldData = item.fieldData || {};
      // Field slugs here must match PHOTO_FIELD_SLUG / DATE_FIELD_SLUG /
      // STATUS_FIELD_SLUG configured in the Worker's wrangler.toml.
      var existing = {
        date: fieldData.date,
        status: fieldData.status,
        photoUrl: fieldData.photo && fieldData.photo.url,
      };
      buildEntryForm('edit', itemId, existing);
    });
  }

  // ---- wiring ----

  function wire() {
    collectProtected();

    document.querySelectorAll('[' + LOGIN_ATTR + ']').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (loggedIn) {
          logout();
        } else {
          openLoginModal();
        }
      });
    });

    document.querySelectorAll('[' + ADD_ATTR + ']').forEach(function (btn) {
      btn.addEventListener('click', openAddModal);
    });

    document.querySelectorAll('[' + EDIT_ATTR + ']').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var itemId = btn.getAttribute(EDIT_ATTR);
        if (itemId) openEditModal(itemId);
      });
    });

    checkSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
`;
