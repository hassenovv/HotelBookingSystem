/* ==========================================================
   common.js  -  small helpers + header/footer used by every page
   Loaded after data.js and api.js.
   ========================================================== */
(function (g) {
  'use strict';

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // XSS protection: any text that came from a user is escaped before it is put into HTML.
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function chip(status) { return '<span class="chip chip--' + esc(status) + '">' + esc(status) + '</span>'; }

  function toast(message, type) {
    let wrap = $('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('role', 'status'); document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'bad' ? ' toast--bad' : '');
    t.textContent = message;
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // Header + footer are written once here, so editing a menu link is a one-line change.
  const PAGES = [
    ['index.html', 'Home'],
    ['booking.html', 'Book a room'],
    ['bookings.html', 'My bookings'],
    ['staff.html', 'Staff panel'],
    ['connection.html', 'Backend'],
    ['docs.html', 'Project docs']
  ];
  function renderLayout() {
    const current = (location.pathname.split('/').pop() || 'index.html');
    const header = $('#site-header');
    const footer = $('#site-footer');
    if (header) {
      header.className = 'site-header';
      header.innerHTML =
        '<div class="container">' +
        '<a class="brand" href="index.html">Grand<span>Stay</span> Hotel</a>' +
        '<nav class="nav" aria-label="Main">' +
        PAGES.map(function (p) {
          return '<a href="' + p[0] + '"' + (p[0] === current ? ' aria-current="page"' : '') + '>' + p[1] + '</a>';
        }).join('') +
        '</nav><a class="api-badge" id="api-badge" href="connection.html" title="Open the backend connection page">…</a></div>';
      wireBadge();
    }
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML =
        '<div class="container"><div><strong>GrandStay Hotel</strong> &middot; 40 rooms &middot; Almaty<br>' +
        'Course project: Hotel Booking System (Introduction to Information Systems, KBTU)</div>' +
        '<div>Payment and email are simulated. Bookings are stored by the backend.<br><a href="docs.html">Read the project documentation</a></div></div>';
    }
  }

  // Badge in the header: shows live whether the frontend is connected to the backend.
  function wireBadge() {
    const badge = $('#api-badge');
    if (!badge || !g.HotelApi || !g.HotelApi.onStatus) { if (badge) badge.remove(); return; }
    g.HotelApi.onStatus(function (st) {
      const where = st.base.replace(/^https?:\/\//, '');
      if (st.mode === 'backend') { badge.className = 'api-badge api-badge--ok'; badge.textContent = '● Backend connected · ' + where + ' · ' + st.requests + ' calls'; }
      else if (st.mode === 'offline') { badge.className = 'api-badge api-badge--bad'; badge.textContent = '● Server not responding'; }
      else if (st.mode === 'mock') { badge.className = 'api-badge api-badge--mock'; badge.textContent = '○ Demo mode (no server)'; }
      else { badge.className = 'api-badge'; badge.textContent = '… connecting'; }
    });
  }

  g.UI = { $: $, $$: $$, esc: esc, money: money, fmtDate: fmtDate, chip: chip, toast: toast, renderLayout: renderLayout };
  document.addEventListener('DOMContentLoaded', renderLayout);
})(window);
