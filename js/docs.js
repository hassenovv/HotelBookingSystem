/* ==========================================================
   docs.js  -  highlights the current section in the side menu
   IntersectionObserver tells us which <section> is on screen.
   ========================================================== */
(function () {
  'use strict';
  const links = Array.prototype.slice.call(document.querySelectorAll('#toc a'));
  const sections = links.map(function (a) { return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id); });
    });
  }, { rootMargin: '-20% 0px -70% 0px' });   // the section that crosses the upper part of the screen is "current"

  sections.forEach(function (s) { observer.observe(s); });
})();
