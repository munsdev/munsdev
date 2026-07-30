// Served at GET /client.js and embedded in Webflow via a single
// <script src="https://api.reflectingpool.us/client.js"></script>
// (Site Settings > Custom Code, or on just the status page).
//
// Wires up three attributes in the Webflow markup:
//   data-poolman-login  - the one login/logout button
//   data-poolman-add    - the "new entry" button
//   data-poolman-edit   - an edit button inside each CMS Collection List
//                          item, with its value bound (via Webflow's own
//                          dynamic-data binding) to that item's CMS id
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

  var overlay, modalBody;

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-poolman-overlay', '');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:9999;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:8px;padding:24px;max-width:420px;width:90%;max-height:85vh;overflow:auto;font-family:sans-serif;';
    modalBody = document.createElement('div');
    box.appendChild(modalBody);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
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
      '<button type="button" data-a="cancel">Cancel</button>' +
      '<button type="button" data-a="submit">Log In</button>' +
      '</div>';

    var errorEl = wrap.querySelector('[data-f="error"]');
    wrap.querySelector('[data-a="cancel"]').addEventListener('click', closeModal);
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

  function buildEntryForm(mode, itemId, existing) {
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<h3 style="margin-top:0">' + (mode === 'edit' ? 'Edit Update' : 'New Update') + '</h3>' +
      '<label style="display:block;margin-bottom:8px">Photo<br>' +
      '<input type="file" accept="image/*" data-f="photo"></label>' +
      '<label style="display:block;margin-bottom:8px">Date &amp; Time<br>' +
      '<input type="datetime-local" data-f="date" style="width:100%;padding:6px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:4px">Status</label>' +
      '<div style="margin-bottom:4px">' +
      '<button type="button" data-cmd="bold" style="font-weight:bold">B</button> ' +
      '<button type="button" data-cmd="italic" style="font-style:italic">I</button> ' +
      '<button type="button" data-cmd="insertUnorderedList">List</button>' +
      '</div>' +
      '<div data-f="status" contenteditable="true" style="border:1px solid #ccc;min-height:100px;padding:8px;margin-bottom:12px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" data-a="cancel">Cancel</button>' +
      '<button type="button" data-a="review">Next</button>' +
      '</div>';

    wrap.querySelectorAll('[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.execCommand(btn.getAttribute('data-cmd'));
      });
    });

    var dateInput = wrap.querySelector('[data-f="date"]');
    dateInput.value = toLocalInputValue(existing && existing.date);
    if (existing && existing.status) {
      wrap.querySelector('[data-f="status"]').innerHTML = existing.status;
    }

    wrap.querySelector('[data-a="cancel"]').addEventListener('click', closeModal);
    wrap.querySelector('[data-a="review"]').addEventListener('click', function () {
      var photoInput = wrap.querySelector('[data-f="photo"]');
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

      var path = mode === 'edit' ? '/submit/' + itemId : '/submit';
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
    apiFetch('/item/' + itemId).then(function (res) {
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
