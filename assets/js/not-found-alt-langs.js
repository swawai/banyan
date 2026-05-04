(function () {
    function parseJson(value, fallback) {
        if (typeof value !== "string" || value === "") {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);
            return parsed == null ? fallback : parsed;
        } catch (_) {
            return fallback;
        }
    }

    try {
        var box = document.getElementById("try-others");
        var links = document.getElementById("alt-lang-links");
        if (!box || !links) {
            return;
        }

        var siteLangs = parseJson(box.dataset.siteLangs, []);
        var defaultLang = box.dataset.defaultLang || "";
        var langHomes = parseJson(box.dataset.langHomes, {});
        if (!Array.isArray(siteLangs) || siteLangs.length === 0) {
            return;
        }

        var path = window.location.pathname;
        var langPrefix = null;
        for (var i = 0; i < siteLangs.length; i += 1) {
            var lang = siteLangs[i];
            if (path === "/" + lang || path.indexOf("/" + lang + "/") === 0) {
                langPrefix = lang;
                break;
            }
        }

        if (!langPrefix) {
            return;
        }

        var rest = path.slice(("/" + langPrefix).length);
        if (rest.charAt(0) === "/") {
            rest = rest.slice(1);
        }
        if (rest === "") {
            return;
        }

        var shown = false;
        siteLangs.forEach(function (lang) {
            if (lang === langPrefix) {
                return;
            }

            var home = langHomes[lang] || (lang === defaultLang ? "/" : "/" + lang + "/");
            var url = rest ? (home === "/" ? "/" + rest : home + rest) : home;

            fetch(url, { method: "HEAD", credentials: "same-origin" })
                .then(function (response) {
                    if (!response || !response.ok) {
                        return;
                    }

                    var link = document.createElement("a");
                    link.href = url;
                    link.textContent = lang;
                    links.appendChild(link);

                    if (!shown) {
                        box.hidden = false;
                        shown = true;
                    }
                })
                .catch(function () { });
        });
    } catch (_) { }
})();
