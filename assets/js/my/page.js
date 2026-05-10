(function () {
    var backLink = document.querySelector('[data-page-action="back"]');

    if (!backLink) {
        return;
    }

    backLink.addEventListener('click', function (event) {
        event.preventDefault();

        if (window.history.length > 1) {
            window.history.back();
            return;
        }

        if (document.referrer) {
            try {
                var current = new URL(window.location.href);
                var previous = new URL(document.referrer, current.href);

                if (previous.origin === current.origin) {
                    window.location.href = previous.href;
                    return;
                }
            } catch (error) {
            }
        }

        var homeLink = document.querySelector('[data-page-home="true"]');
        if (homeLink && homeLink.href) {
            window.location.href = homeLink.href;
        }
    });
}());
