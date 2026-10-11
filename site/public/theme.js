// Light or dark. Runs before the page paints, so there's no flash of the wrong theme.
// With no saved choice the page follows the device's own light/dark setting.
(function () {
  var KEY = "runstride-theme";
  var root = document.documentElement;

  function saved() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null; // private browsing, or storage turned off
    }
  }

  var choice = saved();
  if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);

  function isDark() {
    var set = root.getAttribute("data-theme");
    if (set) return set === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function wire() {
    var button = document.getElementById("theme-toggle");
    if (!button) return;

    function label() {
      var dark = isDark();
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    }

    button.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        // not saved for next time, but the page still switches
      }
      label();
    });

    // Follow the device if the visitor hasn't chosen for themselves
    if (window.matchMedia) {
      var media = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (!saved()) label();
      };
      if (media.addEventListener) media.addEventListener("change", onChange);
      else if (media.addListener) media.addListener(onChange);
    }
    label();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
