/* AEGIS chrome — injects the shared nav rail + footer + CRT overlay on every subpage.
   Active page is set via <body data-page="externum"> (values: root, Docs, externum,
   talus, quantum, nv2, threadcalls, linux-aegis, fortis). */
(function () {
  "use strict";

  var LINKS = [
    { id: "root", label: "ROOT", href: "https://bartoszosiej.github.io/" },
    { id: "blog", label: "/blog", href: "https://bartoszosiej.github.io/blog/" },
    { id: "writing", label: "/writing", href: "https://bartoszosiej.github.io/writing/" },
    { id: "Docs", label: "/Docs", href: "https://bartoszosiej.github.io/Docs/" },
    { id: "externum", label: "/externum", href: "https://bartoszosiej.github.io/externum/" },
    { id: "talus", label: "/talus", href: "https://bartoszosiej.github.io/talus-process-monitor/" },
    { id: "aurora", label: "/aurora", href: "https://bartoszosiej.github.io/Aurora/" },
    { id: "quantum", label: "/quantum-shield", href: "https://bartoszosiej.github.io/quantum-shield/" },
    { id: "nv2", label: "/NV2_ENGINE", href: "https://bartoszosiej.github.io/NV2_ENGINE/" },
    { id: "threadcalls", label: "/thethreadcalls", href: "https://bartoszosiej.github.io/thethreadcalls/" },
    { id: "linux-aegis", label: "/linux-aegis", href: "https://bartoszosiej.github.io/linux-aegis/" },
    { id: "fortis", label: "/fortis", href: "https://bartoszosiej.github.io/fortis/" },
  ];

  function current() {
    return (document.body && document.body.dataset.page) || "root";
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildNav() {
    var nav = el("div", "aegis-nav");
    var brand = el("a", "aegis-nav__brand", '<span>//</span> BARTOSZ_OSIEJ');
    brand.href = "https://bartoszosiej.github.io/";
    var links = el("div", "aegis-nav__links");
    var active = current();
    LINKS.forEach(function (l) {
      var a = el("a", "aegis-nav__link", l.label);
      a.href = l.href;
      if (l.id === active) a.className += " is-active";
      links.appendChild(a);
    });
    nav.appendChild(brand);
    nav.appendChild(links);
    document.body.insertBefore(nav, document.body.firstChild);
  }

  function buildFoot() {
    var f = el("div", "aegis-foot");
    var y = new Date().getFullYear();
    f.innerHTML =
      '© ' + y + ' BARTOSZ_OSIEJ — all systems in one place · <a href="https://bartoszosiej.github.io/">bartoszosiej.github.io</a> · <a href="mailto:thethreadcalls@outlook.com">thethreadcalls@outlook.com</a>';
    document.body.appendChild(f);
  }

  function buildCrt() {
    var c = el("div", "aegis-crt");
    document.body.appendChild(c);
  }

  /* reveal-on-scroll for elements marked .reveal (safe; existing pages add own classes) */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (n) { io.observe(n); });
  }

  function boot() {
    if (!document.body) { return; }
    if (document.querySelector(".aegis-nav")) { return; } /* idempotent */
    buildNav();
    buildFoot();
    buildCrt();
    initReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();