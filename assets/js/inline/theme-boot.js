try {
    var preference = localStorage.getItem("theme-preference");
    var media = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    var theme = (!preference || preference === "auto")
        ? ((media && media.matches) ? "dark" : "light")
        : preference;

    document.documentElement.setAttribute("data-theme", theme);
} catch (_) { }
