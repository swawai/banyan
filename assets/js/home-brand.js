(function () {
    const controlSelector = "[data-home-signal]";
    const homeBrands = Array.from(document.querySelectorAll(".home-brand"));
    const pauseStates = new Map();
    let selectedControl = null;

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

    const initButtons = () => {
        homeBrands.forEach((homeBrand) => {
            homeBrand.querySelectorAll("button[data-home-signal]").forEach((button) => {
                button.setAttribute("aria-pressed", "false");
            });
        });
    };

    const setSelected = (control, selected) => {
        const signal = control.closest(".home-brand__signal");
        control.toggleAttribute("data-home-signal-selected", selected);
        if (control instanceof HTMLButtonElement) {
            control.setAttribute("aria-pressed", selected ? "true" : "false");
        }
        signal?.classList.toggle("is-selected", selected);
    };

    const clearSelected = () => {
        if (!selectedControl) {
            return;
        }

        setSelected(selectedControl, false);
        selectedControl = null;
    };

    document.addEventListener("click", (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const control = target.closest(controlSelector);

        if (!control) {
            if (!target.closest(".home-brand__signals")) {
                clearSelected();
            }
            return;
        }

        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        event.preventDefault();

        if (control === selectedControl) {
            clearSelected();
            return;
        }

        clearSelected();
        selectedControl = control;
        setSelected(control, true);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            clearSelected();
        }
    });

    document.addEventListener("visibilitychange", updateDocumentPause);
    initButtons();
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
