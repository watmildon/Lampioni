/**
 * Lampioni - Italian Street Lights Map
 * https://github.com/your-repo/lampioni
 */

(function() {
    'use strict';

    // Configuration
    var CONFIG = {
        center: [12.5, 42.5],  // Center of Italy
        zoom: 6,
        minZoom: 3,
        maxZoom: 19,
        dataPath: 'data/'
    };

    // State
    var map;
    var stats = null;
    var starfieldCanvas, starfieldCtx;
    var stars = [];
    var popup = null;

    // Layer visibility
    var layerState = {
        baseline: true,
        new: true,
        heatmap: false
    };

    // Time slider state
    var timeState = {
        baselineDate: '2026-02-01',
        minDate: null,
        maxDate: null,
        currentDate: null,
        dates: [],
        isPlaying: false,
        playInterval: null
    };

    // Cached data for filtering
    var cachedData = {
        baseline: null,
        newLamps: null
    };

    // ========================================
    // Starfield
    // ========================================

    function initStarfield() {
        starfieldCanvas = document.getElementById('starfield');
        starfieldCtx = starfieldCanvas.getContext('2d');

        // Seeded random for consistent stars
        var seed = 12345;
        function rand() {
            seed = (seed * 16807 + 0) % 2147483647;
            return seed / 2147483647;
        }

        // Generate 800 stars
        stars = [];
        for (var i = 0; i < 800; i++) {
            stars.push({
                x: rand(),
                y: rand(),
                r: rand() * 1.2 + 0.3,
                brightness: rand() * 0.4 + 0.1
            });
        }

        drawStarfield();
        window.addEventListener('resize', drawStarfield);
    }

    function drawStarfield() {
        var dpr = window.devicePixelRatio || 1;
        var w = window.innerWidth * dpr;
        var h = window.innerHeight * dpr;

        starfieldCanvas.width = w;
        starfieldCanvas.height = h;
        starfieldCanvas.style.width = window.innerWidth + 'px';
        starfieldCanvas.style.height = window.innerHeight + 'px';

        // Dark background
        starfieldCtx.fillStyle = '#000010';
        starfieldCtx.fillRect(0, 0, w, h);

        // Draw stars
        starfieldCtx.fillStyle = '#ffffff';
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            starfieldCtx.globalAlpha = s.brightness;
            starfieldCtx.beginPath();
            starfieldCtx.arc(s.x * w, s.y * h, s.r * dpr, 0, Math.PI * 2);
            starfieldCtx.fill();
        }
        starfieldCtx.globalAlpha = 1;
    }

    // ========================================
    // Map Initialization
    // ========================================

    function initMap() {
        map = new maplibregl.Map({
            container: 'map',
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            center: CONFIG.center,
            zoom: CONFIG.zoom,
            minZoom: CONFIG.minZoom,
            maxZoom: CONFIG.maxZoom,
            attributionControl: true
        });

        // Add navigation controls
        map.addControl(new maplibregl.NavigationControl(), 'bottom-left');

        // Load data when map is ready
        map.on('load', function() {
            setupLayers();
            loadData();
            setupInteractions();
            parseUrlHash();
        });

        // Update URL hash on move
        map.on('moveend', updateUrlHash);

        // Respond to manual URL hash changes
        window.addEventListener('hashchange', parseUrlHash);
    }

    // ========================================
    // Layers
    // ========================================

    function setupLayers() {
        // Baseline street lamps source
        map.addSource('baseline', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // New street lamps source
        map.addSource('new-lamps', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // Heatmap source (combined)
        map.addSource('all-lamps', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // Heatmap layer
        map.addLayer({
            id: 'heatmap',
            type: 'heatmap',
            source: 'all-lamps',
            maxzoom: 12,
            paint: {
                'heatmap-weight': 1,
                'heatmap-intensity': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 0.5,
                    12, 2
                ],
                'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0, 'rgba(0,0,0,0)',
                    0.2, '#ff6600',
                    0.4, '#ff9900',
                    0.6, '#ffcc00',
                    0.8, '#ffff00',
                    1, '#ffffff'
                ],
                'heatmap-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    0, 2,
                    6, 10,
                    12, 20
                ],
                'heatmap-opacity': 0.7
            },
            layout: {
                'visibility': 'none'
            }
        });

        // Baseline glow (behind main layer)
        map.addLayer({
            id: 'baseline-glow',
            type: 'circle',
            source: 'baseline',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    6, 4,
                    12, 8,
                    18, 16
                ],
                'circle-color': '#ffb347',
                'circle-opacity': 0.3,
                'circle-blur': 1
            }
        });

        // Baseline lamps layer - amber/yellow circles
        map.addLayer({
            id: 'baseline-lamps',
            type: 'circle',
            source: 'baseline',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    6, 2,
                    12, 4,
                    18, 8
                ],
                'circle-color': '#ffb347',
                'circle-opacity': 0.9,
                'circle-blur': 0.3
            }
        });

        // New lamps glow (behind main layer)
        map.addLayer({
            id: 'new-glow',
            type: 'circle',
            source: 'new-lamps',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    6, 6,
                    12, 10,
                    18, 20
                ],
                'circle-color': '#00ff88',
                'circle-opacity': 0.4,
                'circle-blur': 1
            }
        });

        // New lamps layer - bright green
        map.addLayer({
            id: 'new-lamps',
            type: 'circle',
            source: 'new-lamps',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    6, 3,
                    12, 5,
                    18, 10
                ],
                'circle-color': '#00ff88',
                'circle-opacity': 1,
                'circle-blur': 0.2
            }
        });
    }

    // ========================================
    // Data Loading
    // ========================================

    function loadData() {
        showLoading(true);

        Promise.all([
            fetch(CONFIG.dataPath + 'stats.json').then(function(r) { return r.json(); }),
            fetch(CONFIG.dataPath + 'streetlamps-baseline.geojson').then(function(r) { return r.json(); }),
            fetch(CONFIG.dataPath + 'streetlamps-new.geojson').then(function(r) { return r.json(); })
        ]).then(function(results) {
            stats = results[0];
            var baseline = results[1];
            var newLamps = results[2];

            // Cache data for time filtering
            cachedData.baseline = baseline;
            cachedData.newLamps = newLamps;

            // Update map sources
            map.getSource('baseline').setData(baseline);
            map.getSource('new-lamps').setData(newLamps);

            // Combine for heatmap
            var allLamps = {
                type: 'FeatureCollection',
                features: baseline.features.concat(newLamps.features)
            };
            map.getSource('all-lamps').setData(allLamps);

            // Initialize time slider
            initTimeSlider();

            // Update stats UI
            updateStatsUI();
            showLoading(false);

        }).catch(function(err) {
            console.error('Failed to load data:', err);
            showLoading(false);
            document.getElementById('stat-total').textContent = 'Error loading data';
        });
    }

    function updateStatsUI() {
        if (!stats) return;

        var total = stats.baseline_count + stats.new_count;
        document.getElementById('stat-total').textContent = formatNumber(total);
        document.getElementById('stat-baseline').textContent = formatNumber(stats.baseline_count);
        document.getElementById('stat-new').textContent = formatNumber(stats.new_count);

        if (stats.last_updated) {
            document.getElementById('stat-updated').textContent =
                I18n.formatRelativeTime(stats.last_updated);
        }

        // Update leaderboard
        var leaderboard = document.getElementById('leaderboard');
        leaderboard.innerHTML = '';

        if (stats.leaderboard) {
            stats.leaderboard.slice(0, 10).forEach(function(entry, i) {
                var li = document.createElement('li');
                var userUrl = 'https://www.openstreetmap.org/user/' + encodeURIComponent(entry.user);
                li.innerHTML =
                    '<span class="rank">' + (i + 1) + '.</span>' +
                    '<a class="user" href="' + userUrl + '" target="_blank">' + escapeHtml(entry.user) + '</a>' +
                    '<span class="count">' + entry.count + '</span>';
                leaderboard.appendChild(li);
            });
        }
    }

    // ========================================
    // Time Slider
    // ========================================

    function initTimeSlider() {
        // Build list of unique dates from new lamps and stats
        var dateSet = {};
        dateSet[timeState.baselineDate] = true;

        // Add dates from new lamps features
        if (cachedData.newLamps && cachedData.newLamps.features) {
            cachedData.newLamps.features.forEach(function(f) {
                var d = f.properties.date_added;
                if (d) dateSet[d] = true;
            });
        }

        // Also include dates from stats.daily_additions for completeness
        if (stats && stats.daily_additions) {
            Object.keys(stats.daily_additions).forEach(function(d) {
                dateSet[d] = true;
            });
        }

        // Sort dates
        timeState.dates = Object.keys(dateSet).sort();

        if (timeState.dates.length === 0) {
            timeState.dates = [timeState.baselineDate];
        }

        timeState.minDate = timeState.dates[0];
        timeState.maxDate = timeState.dates[timeState.dates.length - 1];
        timeState.currentDate = timeState.maxDate;

        // Configure slider
        var slider = document.getElementById('time-slider');
        slider.min = 0;
        slider.max = timeState.dates.length - 1;
        slider.value = timeState.dates.length - 1;

        // Update labels
        document.getElementById('time-min').textContent = formatDateShort(timeState.minDate);
        document.getElementById('time-max').textContent = formatDateShort(timeState.maxDate);

        // Update display
        updateTimeDisplay();

        // Event listeners
        slider.addEventListener('input', handleTimeSliderChange);

        document.getElementById('time-play').addEventListener('click', toggleTimePlay);
        document.getElementById('time-reset').addEventListener('click', resetTimeSlider);
    }

    function handleTimeSliderChange() {
        var slider = document.getElementById('time-slider');
        var index = parseInt(slider.value, 10);
        timeState.currentDate = timeState.dates[index];

        updateTimeDisplay();
        filterDataByDate();
        updateUrlHash();
    }

    function updateTimeDisplay() {
        var dateEl = document.getElementById('time-current-date');
        var countEl = document.getElementById('time-lamp-count');

        dateEl.textContent = formatDateLong(timeState.currentDate);

        // Calculate lamp count up to this date
        var count = countLampsUpToDate(timeState.currentDate);
        countEl.textContent = formatNumber(count) + ' ' + I18n.t('lamps');
    }

    function countLampsUpToDate(date) {
        var count = 0;

        // All baseline lamps are included (they predate the baseline)
        if (cachedData.baseline) {
            count += cachedData.baseline.features.length;
        }

        // Count new lamps up to date
        if (cachedData.newLamps) {
            cachedData.newLamps.features.forEach(function(f) {
                var d = f.properties.date_added || timeState.baselineDate;
                if (d <= date) count++;
            });
        }

        return count;
    }

    function filterDataByDate() {
        var date = timeState.currentDate;

        // Baseline is always fully included (all pre-date baseline)
        // Just update new lamps based on date
        var filteredNew = {
            type: 'FeatureCollection',
            features: []
        };

        if (cachedData.newLamps) {
            filteredNew.features = cachedData.newLamps.features.filter(function(f) {
                var d = f.properties.date_added || timeState.baselineDate;
                return d <= date;
            });
        }

        // Update sources
        map.getSource('new-lamps').setData(filteredNew);

        // Update heatmap (baseline + filtered new)
        var allLamps = {
            type: 'FeatureCollection',
            features: cachedData.baseline.features.concat(filteredNew.features)
        };
        map.getSource('all-lamps').setData(allLamps);

        // Update stats display for this date
        updateFilteredStats(filteredNew.features.length);
    }

    function updateFilteredStats(newCount) {
        var baselineCount = cachedData.baseline ? cachedData.baseline.features.length : 0;
        var total = baselineCount + newCount;

        document.getElementById('stat-total').textContent = formatNumber(total);
        document.getElementById('stat-new').textContent = formatNumber(newCount);
    }

    function toggleTimePlay() {
        var btn = document.getElementById('time-play');

        if (timeState.isPlaying) {
            stopTimePlay();
        } else {
            startTimePlay();
        }

        btn.classList.toggle('playing', timeState.isPlaying);
        updatePlayButtonIcon();
    }

    function startTimePlay() {
        var slider = document.getElementById('time-slider');

        // If at end, start from beginning
        if (parseInt(slider.value, 10) >= timeState.dates.length - 1) {
            slider.value = 0;
            handleTimeSliderChange();
        }

        timeState.isPlaying = true;

        timeState.playInterval = setInterval(function() {
            var current = parseInt(slider.value, 10);

            if (current >= timeState.dates.length - 1) {
                stopTimePlay();
                return;
            }

            slider.value = current + 1;
            handleTimeSliderChange();
        }, 500); // Advance every 500ms
    }

    function stopTimePlay() {
        timeState.isPlaying = false;

        if (timeState.playInterval) {
            clearInterval(timeState.playInterval);
            timeState.playInterval = null;
        }

        document.getElementById('time-play').classList.remove('playing');
        updatePlayButtonIcon();
    }

    function updatePlayButtonIcon() {
        var btn = document.getElementById('time-play');
        if (timeState.isPlaying) {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        } else {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        }
    }

    function resetTimeSlider() {
        stopTimePlay();

        var slider = document.getElementById('time-slider');
        slider.value = timeState.dates.length - 1;
        timeState.currentDate = timeState.maxDate;

        updateTimeDisplay();

        // Restore full data
        map.getSource('new-lamps').setData(cachedData.newLamps);

        var allLamps = {
            type: 'FeatureCollection',
            features: cachedData.baseline.features.concat(cachedData.newLamps.features)
        };
        map.getSource('all-lamps').setData(allLamps);

        // Restore full stats
        updateStatsUI();
    }

    function formatDateShort(dateStr) {
        if (!dateStr) return '-';
        var parts = dateStr.split('-');
        var months = I18n.t('monthsShort').split(',');
        var month = months[parseInt(parts[1], 10) - 1] || parts[1];
        return month + ' ' + parseInt(parts[2], 10);
    }

    function formatDateLong(dateStr) {
        if (!dateStr) return '-';
        var parts = dateStr.split('-');
        var months = I18n.t('monthsLong').split(',');
        var month = months[parseInt(parts[1], 10) - 1] || parts[1];
        return month + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
    }

    function updateLeaderboardToggleText() {
        var btn = document.getElementById('leaderboard-toggle');
        var isExpanded = document.getElementById('leaderboard-section').classList.contains('expanded');
        btn.textContent = isExpanded ? I18n.t('hideLeaderboard') : I18n.t('showLeaderboard');
    }

    // ========================================
    // Interactions
    // ========================================

    function setupInteractions() {
        // Sync layerState with actual checkbox values on load
        layerState.baseline = document.getElementById('layer-baseline').checked;
        layerState.new = document.getElementById('layer-new').checked;
        layerState.heatmap = document.getElementById('layer-heatmap').checked;
        updateLayerVisibility();

        // Layer toggles
        document.getElementById('layer-baseline').addEventListener('change', function() {
            layerState.baseline = this.checked;
            updateLayerVisibility();
        });

        document.getElementById('layer-new').addEventListener('change', function() {
            layerState.new = this.checked;
            updateLayerVisibility();
        });

        document.getElementById('layer-heatmap').addEventListener('change', function() {
            layerState.heatmap = this.checked;
            updateLayerVisibility();
        });

        // Language toggle
        document.getElementById('lang-toggle').addEventListener('click', function() {
            I18n.toggle();
            updateStatsUI();
            updateLeaderboardToggleText();
        });

        // Leaderboard toggle (mobile)
        document.getElementById('leaderboard-toggle').addEventListener('click', function() {
            var section = document.getElementById('leaderboard-section');
            var isExpanded = section.classList.toggle('expanded');
            this.classList.toggle('expanded', isExpanded);
            updateLeaderboardToggleText();
        });

        // Map click for popups
        map.on('click', handleMapClick);

        // Cursor change on hover
        map.on('mousemove', function(e) {
            var layers = [];
            if (map.getLayer('baseline-lamps')) layers.push('baseline-lamps');
            if (map.getLayer('new-lamps')) layers.push('new-lamps');

            if (layers.length === 0) return;

            var features = map.queryRenderedFeatures(e.point, { layers: layers });
            map.getCanvas().style.cursor = features.length ? 'pointer' : '';
        });
    }

    function updateLayerVisibility() {
        var vis = function(visible) { return visible ? 'visible' : 'none'; };

        map.setLayoutProperty('baseline-lamps', 'visibility', vis(layerState.baseline));
        map.setLayoutProperty('baseline-glow', 'visibility', vis(layerState.baseline));
        map.setLayoutProperty('new-lamps', 'visibility', vis(layerState.new));
        map.setLayoutProperty('new-glow', 'visibility', vis(layerState.new));
        map.setLayoutProperty('heatmap', 'visibility', vis(layerState.heatmap));
    }

    function handleMapClick(e) {
        // Close existing popup
        if (popup) {
            popup.remove();
            popup = null;
        }

        // Query features
        var layers = [];
        if (map.getLayer('baseline-lamps')) layers.push('baseline-lamps');
        if (map.getLayer('new-lamps')) layers.push('new-lamps');

        if (layers.length === 0) return;

        var features = map.queryRenderedFeatures(e.point, { layers: layers });

        if (!features.length) return;

        var feature = features[0];
        var props = feature.properties;
        var coords = feature.geometry.coordinates;

        var html = buildPopupHTML(props, feature.layer.id);

        popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
            .setLngLat(coords)
            .setHTML(html)
            .addTo(map);
    }

    function buildPopupHTML(props, layerId) {
        var isNew = layerId === 'new-lamps';

        var html = '<div class="popup-title">Street Lamp';
        if (isNew) {
            html += '<span class="popup-new-badge">NEW</span>';
        }
        html += '</div>';

        // Tags
        html += '<div class="popup-tags">';

        if (isNew && props.date_added) {
            html += '<span class="key">' + I18n.t('addedOn') + '</span>';
            html += '<span class="value">' + props.date_added + '</span>';
        }

        if (isNew && props.user) {
            html += '<span class="key">' + I18n.t('addedBy') + '</span>';
            html += '<span class="value">' + escapeHtml(props.user) + '</span>';
        }

        var tagMap = {
            'lamp_mount': 'lampMount',
            'lamp_type': 'lampType',
            'support': 'support',
            'operator': 'operator',
            'ref': 'ref',
            'height': 'height'
        };

        for (var key in tagMap) {
            if (props[key]) {
                html += '<span class="key">' + I18n.t(tagMap[key]) + '</span>';
                html += '<span class="value">' + escapeHtml(props[key]) + '</span>';
            }
        }

        html += '</div>';

        // OSM link
        var osmType = props.osm_type || 'node';
        var osmId = props.osm_id;
        if (osmId) {
            var osmUrl = 'https://www.openstreetmap.org/' + osmType + '/' + osmId;
            html += '<a href="' + osmUrl + '" target="_blank" class="popup-link">' +
                    I18n.t('viewOnOSM') + ' &rarr;</a>';
        }

        return html;
    }

    // ========================================
    // URL Hash
    // ========================================

    function parseUrlHash() {
        var hash = window.location.hash;
        if (!hash) return;

        // Format: #map=zoom/lat/lng or #map=zoom/lat/lng/date
        var match = hash.match(/#map=([0-9.]+)\/([0-9.-]+)\/([0-9.-]+)(?:\/(\d{4}-\d{2}-\d{2}))?/);
        if (match) {
            var zoom = parseFloat(match[1]);
            var lat = parseFloat(match[2]);
            var lng = parseFloat(match[3]);
            var date = match[4];

            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)) {
                map.setCenter([lng, lat]);
                map.setZoom(zoom);
            }

            // Apply date from URL if valid
            if (date && timeState.dates && timeState.dates.length > 0) {
                var dateIndex = timeState.dates.indexOf(date);
                if (dateIndex >= 0) {
                    var slider = document.getElementById('time-slider');
                    slider.value = dateIndex;
                    timeState.currentDate = date;
                    updateTimeDisplay();
                    filterDataByDate();
                }
            }
        }
    }

    function updateUrlHash() {
        var center = map.getCenter();
        var zoom = map.getZoom().toFixed(1);
        var hash = '#map=' + zoom + '/' + center.lat.toFixed(5) + '/' + center.lng.toFixed(5);

        // Add date to hash if not at max (today)
        if (timeState.currentDate && timeState.currentDate !== timeState.maxDate) {
            hash += '/' + timeState.currentDate;
        }

        history.replaceState(null, null, hash);
    }

    // ========================================
    // Utilities
    // ========================================

    function showLoading(show) {
        document.getElementById('loading').classList.toggle('hidden', !show);
    }

    function formatNumber(n) {
        return n.toLocaleString();
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ========================================
    // Initialize
    // ========================================

    function init() {
        I18n.updateUI();
        initStarfield();
        initMap();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
