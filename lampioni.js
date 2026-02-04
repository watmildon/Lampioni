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

            // Update map sources
            map.getSource('baseline').setData(baseline);
            map.getSource('new-lamps').setData(newLamps);

            // Combine for heatmap
            var allLamps = {
                type: 'FeatureCollection',
                features: baseline.features.concat(newLamps.features)
            };
            map.getSource('all-lamps').setData(allLamps);

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
                li.innerHTML =
                    '<span class="rank">' + (i + 1) + '.</span>' +
                    '<span class="user">' + escapeHtml(entry.user) + '</span>' +
                    '<span class="count">' + entry.count + '</span>';
                leaderboard.appendChild(li);
            });
        }
    }

    // ========================================
    // Interactions
    // ========================================

    function setupInteractions() {
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

        // Format: #map=zoom/lat/lng
        var match = hash.match(/#map=([0-9.]+)\/([0-9.-]+)\/([0-9.-]+)/);
        if (match) {
            var zoom = parseFloat(match[1]);
            var lat = parseFloat(match[2]);
            var lng = parseFloat(match[3]);

            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)) {
                map.setCenter([lng, lat]);
                map.setZoom(zoom);
            }
        }
    }

    function updateUrlHash() {
        var center = map.getCenter();
        var zoom = map.getZoom().toFixed(1);
        var hash = '#map=' + zoom + '/' + center.lat.toFixed(5) + '/' + center.lng.toFixed(5);
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
