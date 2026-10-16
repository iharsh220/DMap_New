(function() {
    function applyTheme() {
        var theme = localStorage.getItem('themePreference');
        if (theme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }
        updateToggleIcon();
    }

    function updateToggleIcon() {
        var btn = document.getElementById('themeToggle');
        if (!btn) return;
        var icon = btn.querySelector('i');
        if (!icon) return;
        icon.className = document.body.classList.contains('light-theme')
            ? 'bi bi-sun'
            : 'bi bi-moon';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            applyTheme();
            var btn = document.getElementById('themeToggle');
            if (!btn) return;
            btn.addEventListener('click', function() {
                document.body.classList.toggle('light-theme');
                if (document.body.classList.contains('light-theme')) {
                    localStorage.setItem('themePreference', 'light');
                } else {
                    localStorage.setItem('themePreference', 'dark');
                }
                updateToggleIcon();
            });
        });
    } else {
        applyTheme();
        var btn = document.getElementById('themeToggle');
        if (btn) {
            btn.addEventListener('click', function() {
                document.body.classList.toggle('light-theme');
                if (document.body.classList.contains('light-theme')) {
                    localStorage.setItem('themePreference', 'light');
                } else {
                    localStorage.setItem('themePreference', 'dark');
                }
                updateToggleIcon();
            });
        }
    }
})();
