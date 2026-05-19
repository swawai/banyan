(function () {
    const linkSelector = "[data-home-brand-signal-link]";
    const homeBrands = Array.from(document.querySelectorAll(".home-brand"));
    const pauseStates = new Map();
    let selectedLink = null;

    const setPaused = (homeBrand, source, paused) => {
        if (!homeBrand) {
            return;
        }

        const state = pauseStates.get(homeBrand) || {
            document: document.hidden,
            viewport: false,
        };

        state[source] = paused;
        pauseStates.set(homeBrand, state);
        homeBrand.classList.toggle("is-paused", state.document || state.viewport);
    };

    const updateDocumentPause = () => {
        homeBrands.forEach((homeBrand) => {
            setPaused(homeBrand, "document", document.hidden);
        });
    };

    const setSelected = (link, selected) => {
        const signal = link.closest(".home-brand__signal");
        link.toggleAttribute("data-home-brand-signal-selected", selected);
        signal?.classList.toggle("is-selected", selected);
    };

    const clearSelected = () => {
        if (!selectedLink) {
            return;
        }

        setSelected(selectedLink, false);
        selectedLink = null;
    };

    document.addEventListener("click", (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const link = target.closest(linkSelector);

        if (!link) {
            if (!target.closest(".home-brand__signals")) {
                clearSelected();
            }
            return;
        }

        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        if (link === selectedLink) {
            clearSelected();
            return;
        }

        event.preventDefault();
        clearSelected();
        selectedLink = link;
        setSelected(link, true);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            clearSelected();
        }
    });

    document.addEventListener("visibilitychange", updateDocumentPause);
    updateDocumentPause();

    if ("IntersectionObserver" in window) {
        const sceneObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                setPaused(entry.target.closest(".home-brand"), "viewport", !entry.isIntersecting);
            });
        });

        homeBrands.forEach((homeBrand) => {
            sceneObserver.observe(homeBrand.querySelector(".home-brand__scene") || homeBrand);
        });
    }
})();
