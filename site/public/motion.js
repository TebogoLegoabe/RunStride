// Small page behaviours: reveal sections as they scroll in, and shade the header once
// the page has moved. Everything degrades to "just visible" without JavaScript.
(function () {
  var root = document.documentElement;
  root.classList.remove("no-js");

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = document.querySelectorAll(".reveal");

  if (reduced || !("IntersectionObserver" in window)) {
    for (var i = 0; i < items.length; i++) items[i].classList.add("in");
  } else {
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          seen.unobserve(entry.target); // reveal once, then leave it alone
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    items.forEach(function (item) {
      seen.observe(item);
    });
  }

  var header = document.getElementById("top");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
})();
