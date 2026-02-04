/**
 * Simple internationalization for Lampioni
 */

var I18n = (function() {
    var strings = {
        en: {
            title: "Lampioni",
            layers: "Layers",
            baseline: "Baseline (Feb 1)",
            newLamps: "New lamps",
            litFeatures: "Lit features",
            heatmap: "Heatmap",
            statistics: "Statistics",
            total: "Total",
            newSinceFeb1: "New since Feb 1",
            lastUpdated: "Last updated",
            topContributors: "Top Contributors",
            loading: "Loading data...",
            viewOnOSM: "View on OpenStreetMap",
            editOnOSM: "Edit on OpenStreetMap",
            addedOn: "Added on",
            addedBy: "Added by",
            lampMount: "Mount type",
            lampType: "Lamp type",
            support: "Support",
            operator: "Operator",
            ref: "Reference",
            height: "Height",
            hoursAgo: "h ago",
            daysAgo: "d ago",
            justNow: "just now",
            timeSlider: "Time Travel",
            lamps: "lamps",
            resetToToday: "Reset to today",
            monthsShort: "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec",
            monthsLong: "January,February,March,April,May,June,July,August,September,October,November,December"
        },
        it: {
            title: "Lampioni",
            layers: "Livelli",
            baseline: "Base (1 Feb)",
            newLamps: "Nuovi lampioni",
            litFeatures: "Illuminazione",
            heatmap: "Mappa di calore",
            statistics: "Statistiche",
            total: "Totale",
            newSinceFeb1: "Nuovi dal 1 Feb",
            lastUpdated: "Aggiornato",
            topContributors: "Top Contributori",
            loading: "Caricamento...",
            viewOnOSM: "Vedi su OpenStreetMap",
            editOnOSM: "Modifica su OpenStreetMap",
            addedOn: "Aggiunto il",
            addedBy: "Aggiunto da",
            lampMount: "Tipo montaggio",
            lampType: "Tipo lampada",
            support: "Supporto",
            operator: "Operatore",
            ref: "Riferimento",
            height: "Altezza",
            hoursAgo: "h fa",
            daysAgo: "g fa",
            justNow: "adesso",
            timeSlider: "Viaggio nel tempo",
            lamps: "lampioni",
            resetToToday: "Torna ad oggi",
            monthsShort: "Gen,Feb,Mar,Apr,Mag,Giu,Lug,Ago,Set,Ott,Nov,Dic",
            monthsLong: "Gennaio,Febbraio,Marzo,Aprile,Maggio,Giugno,Luglio,Agosto,Settembre,Ottobre,Novembre,Dicembre"
        }
    };

    function detectLanguage() {
        var stored = localStorage.getItem('lampioni-lang');
        if (stored) return stored;

        var browserLang = navigator.language || navigator.userLanguage || 'en';
        return browserLang.toLowerCase().startsWith('it') ? 'it' : 'en';
    }

    var currentLang = detectLanguage();

    function t(key) {
        return strings[currentLang][key] || strings.en[key] || key;
    }

    function setLang(lang) {
        if (strings[lang]) {
            currentLang = lang;
            localStorage.setItem('lampioni-lang', lang);
            updateUI();
        }
    }

    function getLang() {
        return currentLang;
    }

    function toggle() {
        setLang(currentLang === 'en' ? 'it' : 'en');
    }

    function updateUI() {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            var key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });

        // Update language toggle button
        var btn = document.getElementById('lang-toggle');
        if (btn) {
            btn.textContent = currentLang === 'en' ? 'IT' : 'EN';
        }
    }

    function formatRelativeTime(isoString) {
        var date = new Date(isoString);
        var now = new Date();
        var diffMs = now - date;
        var diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffHours < 1) {
            return t('justNow');
        } else if (diffHours < 24) {
            return diffHours + t('hoursAgo');
        } else {
            return diffDays + t('daysAgo');
        }
    }

    return {
        t: t,
        setLang: setLang,
        getLang: getLang,
        toggle: toggle,
        updateUI: updateUI,
        formatRelativeTime: formatRelativeTime
    };
})();
