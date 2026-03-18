// ═══════════════════════════════════════════════════
//  MetalDoctor — Frontend Controller
// ═══════════════════════════════════════════════════

class MetalDoctor {
  constructor() {
    this.events = [];
    this.stability = [];
    this.activeFilters = new Set(['crash', 'hardware']);
    this.chartRange = 'all';
    // Chart coordinate state for crosshair
    this.chartState = null;
    this.init();
  }

  async init() {
    this.bindControls();
    this.bindChartHover();
    await this.loadAll();
  }

  bindControls() {
    document.getElementById('sync-btn').addEventListener('click', () => this.loadAll(true));

    // Zoom controls
    var self = this;
    var steps = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22];
    var zoomIdx = parseInt(localStorage.getItem('md-zoom') || '4', 10); // default 14px
    this.applyZoom(steps, zoomIdx);

    document.getElementById('zoom-in').addEventListener('click', function () {
      if (zoomIdx < steps.length - 1) {
        zoomIdx++;
        localStorage.setItem('md-zoom', zoomIdx);
        self.applyZoom(steps, zoomIdx);
      }
    });
    document.getElementById('zoom-out').addEventListener('click', function () {
      if (zoomIdx > 0) {
        zoomIdx--;
        localStorage.setItem('md-zoom', zoomIdx);
        self.applyZoom(steps, zoomIdx);
      }
    });

    document.querySelectorAll('.chart-range').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-range').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.chartRange = btn.dataset.range;
        this.drawChart();
      });
    });

    document.querySelectorAll('.log-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        if (cat === 'all') {
          const allActive = this.activeFilters.size >= 4;
          this.activeFilters = allActive
            ? new Set(['crash', 'hardware'])
            : new Set(['crash', 'hardware', 'boot', 'shutdown']);
        } else {
          if (this.activeFilters.has(cat)) this.activeFilters.delete(cat);
          else this.activeFilters.add(cat);
        }
        this.updateFilterButtons();
        this.renderLog();
      });
    });
  }

  bindChartHover() {
    var self = this;
    var chartArea = document.getElementById('chart-area');
    var raf = null;

    chartArea.addEventListener('mousemove', function (ev) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        self.drawCrosshair(ev);
      });
    });

    chartArea.addEventListener('mouseleave', function () {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      self.clearCrosshair();
    });
  }

  drawCrosshair(ev) {
    var cs = this.chartState;
    if (!cs || cs.data.length === 0) return;

    var overlay = document.getElementById('chart-overlay');
    var tooltip = document.getElementById('chart-tooltip');
    var rect = overlay.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;

    // Match overlay size to main canvas
    overlay.width = rect.width * dpr;
    overlay.height = 220 * dpr;
    overlay.style.width = rect.width + 'px';
    overlay.style.height = '220px';

    var ctx = overlay.getContext('2d');
    ctx.scale(dpr, dpr);

    var mouseX = ev.clientX - rect.left;
    var mouseY = ev.clientY - rect.top;

    // Clamp to chart area
    if (mouseX < cs.pad.left || mouseX > cs.W - cs.pad.right) {
      this.clearCrosshair();
      return;
    }

    // Convert pixel to timestamp
    var hoverT = cs.minT + ((mouseX - cs.pad.left) / cs.cW) * cs.rangeT;

    // Find nearest stability point
    var nearest = null;
    var nearestDist = Infinity;
    for (var i = 0; i < cs.data.length; i++) {
      var dist = Math.abs(cs.times[i] - hoverT);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }

    if (nearest === null) return;

    var snapX = cs.pad.left + ((cs.times[nearest] - cs.minT) / cs.rangeT) * cs.cW;
    var snapY = cs.pad.top + cs.cH - (cs.data[nearest].stabilityIndex / 10) * cs.cH;
    var val = cs.data[nearest].stabilityIndex;

    // Clear overlay
    ctx.clearRect(0, 0, cs.W, 220);

    // Vertical crosshair line
    ctx.strokeStyle = 'rgba(176, 180, 192, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(snapX, cs.pad.top);
    ctx.lineTo(snapX, cs.pad.top + cs.cH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Horizontal crosshair line
    ctx.strokeStyle = 'rgba(176, 180, 192, 0.15)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cs.pad.left, snapY);
    ctx.lineTo(cs.W - cs.pad.right, snapY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Snap dot
    var dotColor = val < 4 ? '#ef4444' : val < 7 ? '#f59e0b' : '#4ade80';
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(snapX, snapY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(snapX, snapY, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Tooltip
    var d = new Date(cs.times[nearest]);
    var timeStr = String(d.getDate()).padStart(2, '0') + '/' +
                  String(d.getMonth() + 1).padStart(2, '0') + ' ' +
                  String(d.getHours()).padStart(2, '0') + ':' +
                  String(d.getMinutes()).padStart(2, '0');

    var valClass = val < 4 ? 'critical' : val < 7 ? 'warning' : 'good';

    // Find events near this timestamp (±30 min window)
    var windowMs = 30 * 60 * 1000;
    var nearbyEvents = this.events.filter(function (e) {
      var et = new Date(e.timestamp).getTime();
      return Math.abs(et - cs.times[nearest]) < windowMs &&
             (e.category === 'crash' || e.category === 'hardware');
    });

    var eventsHtml = '';
    if (nearbyEvents.length > 0) {
      eventsHtml = '<div class="ct-events">' + nearbyEvents.length +
                   ' event' + (nearbyEvents.length > 1 ? 's' : '') + ' nearby</div>';
    }

    tooltip.style.display = 'block';
    // Position tooltip - flip if near right edge
    var tipX = snapX + 12;
    var tipY = snapY - 10;
    if (snapX > cs.W * 0.7) tipX = snapX - 140;
    if (snapY < 50) tipY = snapY + 20;
    tooltip.style.left = tipX + 'px';
    tooltip.style.top = tipY + 'px';

    // Build tooltip content safely
    tooltip.textContent = '';
    var valSpan = document.createElement('span');
    valSpan.className = 'ct-val ' + valClass;
    valSpan.textContent = val.toFixed(1);
    tooltip.appendChild(valSpan);
    tooltip.appendChild(document.createTextNode('/10'));
    tooltip.appendChild(document.createElement('br'));
    var timeSpan = document.createElement('span');
    timeSpan.className = 'ct-time';
    timeSpan.textContent = timeStr;
    tooltip.appendChild(timeSpan);
    if (nearbyEvents.length > 0) {
      var evDiv = document.createElement('div');
      evDiv.className = 'ct-events';
      evDiv.textContent = nearbyEvents.length + ' event' + (nearbyEvents.length > 1 ? 's' : '') + ' nearby';
      tooltip.appendChild(evDiv);
    }

    // Highlight matching log rows
    this.highlightLogRows(cs.times[nearest], windowMs);
  }

  clearCrosshair() {
    var overlay = document.getElementById('chart-overlay');
    var ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    document.getElementById('chart-tooltip').style.display = 'none';

    // Remove all highlights
    var rows = document.querySelectorAll('.chart-highlight');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove('chart-highlight');
    }
  }

  highlightLogRows(centerTime, windowMs) {
    var rows = document.getElementById('log-body').children;
    var firstMatch = null;
    var lastMatch = null;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var ts = row.getAttribute('data-ts');
      if (!ts) { row.classList.remove('chart-highlight'); continue; }
      var t = parseInt(ts, 10);
      var match = Math.abs(t - centerTime) < windowMs;
      row.classList.toggle('chart-highlight', match);
      if (match) {
        if (!firstMatch) firstMatch = row;
        lastMatch = row;
      }
    }

    // Scroll so the entire highlighted group is visible
    if (firstMatch && lastMatch) {
      var container = document.querySelector('.log-table-wrap');
      var cRect = container.getBoundingClientRect();
      var fRect = firstMatch.getBoundingClientRect();
      var lRect = lastMatch.getBoundingClientRect();

      var groupTop = fRect.top - cRect.top + container.scrollTop;
      var groupBot = lRect.bottom - cRect.top + container.scrollTop;
      var groupH = groupBot - groupTop;

      if (groupH <= cRect.height) {
        // Group fits — center it in the scroll container
        var target = groupTop - (cRect.height - groupH) / 2;
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      } else {
        // Group too tall — scroll to the top of the group
        container.scrollTo({ top: Math.max(0, groupTop - 8), behavior: 'smooth' });
      }
    }
  }

  updateFilterButtons() {
    document.querySelectorAll('.log-filter').forEach(btn => {
      const cat = btn.dataset.cat;
      if (cat === 'all') {
        btn.classList.toggle('active', this.activeFilters.size >= 4);
      } else {
        btn.classList.toggle('active', this.activeFilters.has(cat));
      }
    });
  }

  async loadAll(forceRefresh = false) {
    const btn = document.getElementById('sync-btn');
    btn.disabled = true;
    btn.classList.add('syncing');
    btn.textContent = 'SYNCING...';

    try {
      const qs = forceRefresh ? '?refresh=1' : '';
      const [timelineRes, historyRes] = await Promise.all([
        fetch('/api/timeline' + qs),
        fetch('/api/history' + qs),
      ]);

      if (timelineRes.ok) {
        const data = await timelineRes.json();
        if (Array.isArray(data)) this.events = data;
      }

      if (historyRes.ok) {
        const data = await historyRes.json();
        this.stability = data.stability || [];
        if (this.events.length === 0 && Array.isArray(data.events)) {
          this.events = data.events;
        }
      }

      this.render();
      document.getElementById('last-sync').textContent = 'Last sync: ' + this.fmtTime(new Date());
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('syncing');
      btn.textContent = 'SYNC';
    }
  }

  render() {
    this.renderHeader();
    this.renderGauge();
    this.renderStats();
    this.renderApicGrid();
    this.drawChart();
    this.renderLog();
  }

  // ─── Header ───
  renderHeader() {
    // Extract machine name from shutdown events (contains hostname in description)
    var nameEl = document.getElementById('machine-name');
    for (var i = 0; i < this.events.length; i++) {
      var desc = this.events[i].description || '';
      // Match common Windows hostname patterns from event descriptions
      var hostMatch = desc.match(/ordinateur\s+(\S+)/i) || desc.match(/computer\s+(\S+)/i);
      if (hostMatch) {
        nameEl.textContent = hostMatch[1];
        break;
      }
    }

    const lastBoot = this.events.find(e => e.category === 'boot');
    if (lastBoot) {
      const bootTime = new Date(lastBoot.timestamp);
      const diff = Date.now() - bootTime.getTime();
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      document.getElementById('uptime').textContent = 'UP ' + hrs + 'h ' + mins + 'm';
    }
  }

  // ─── Gauge ───
  renderGauge() {
    const el = document.getElementById('gauge-value');
    const fill = document.getElementById('gauge-fill');
    const delta = document.getElementById('gauge-delta');

    if (this.stability.length === 0) {
      el.textContent = '--';
      return;
    }

    const latest = this.stability[this.stability.length - 1];
    const val = latest.stabilityIndex;
    el.textContent = val.toFixed(1);

    el.className = 'gauge-value';
    fill.className = 'gauge-bar-fill';
    if (val < 4) { el.classList.add('critical'); fill.classList.add('critical'); }
    else if (val < 7) { el.classList.add('warning'); fill.classList.add('warning'); }
    else { el.classList.add('good'); }

    fill.style.width = ((val / 10) * 100) + '%';

    if (this.stability.length >= 2) {
      const prev = this.stability[this.stability.length - 2].stabilityIndex;
      const d = val - prev;
      if (d !== 0) {
        delta.textContent = (d > 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1);
        delta.className = 'gauge-delta ' + (d > 0 ? 'up' : 'down');
      } else {
        delta.textContent = '\u2014 stable';
        delta.className = 'gauge-delta';
      }
    }
  }

  // ─── Stats ───
  renderStats() {
    const counts = { crash: 0, hardware: 0, boot: 0, shutdown: 0 };
    for (const e of this.events) {
      if (e.category === 'crash' && e.severity === 'critical') counts.crash++;
      else if (e.category === 'hardware') counts.hardware++;
      else if (e.category === 'boot') counts.boot++;
      else if (e.category === 'shutdown') counts.shutdown++;
    }

    document.getElementById('stat-crashes').textContent = counts.crash;
    document.getElementById('stat-hardware').textContent = counts.hardware;
    document.getElementById('stat-boots').textContent = counts.boot;
    document.getElementById('stat-shutdowns').textContent = counts.shutdown;
  }

  // ─── APIC Heatmap ───
  renderApicGrid() {
    const grid = document.getElementById('apic-grid');
    const apicCounts = {};

    for (const e of this.events) {
      if (e.category !== 'hardware') continue;
      const match = e.description
        ? (e.description.match(/APIC[^:]*:\s*(\d+)/i) || e.description.match(/ID APIC[^:]*:\s*(\d+)/i))
        : null;
      if (match) {
        const id = parseInt(match[1], 10);
        apicCounts[id] = (apicCounts[id] || 0) + 1;
      }
    }

    const maxCount = Math.max(1, ...Object.values(apicCounts));

    // Auto-detect APIC topology from observed IDs
    var allApicIds = Object.keys(apicCounts).map(Number);
    var maxApic = allApicIds.length > 0 ? Math.max.apply(null, allApicIds) : 0;
    // Round up to next multiple of 8 for grid alignment, min 32
    var gridSize = Math.max(32, Math.ceil((maxApic + 1) / 8) * 8);

    // Detect CCD groups: group IDs into ranges with gaps
    // Common AMD layout: CCD0 = 0-11, CCD1 = 16-27 (gap at 12-15)
    // We auto-detect by finding contiguous ranges of possible core IDs
    var ccdGroups = [];
    var inGroup = false;
    var groupStart = 0;
    for (var id = 0; id < gridSize; id++) {
      var hasNearby = false;
      for (var j = Math.max(0, id - 1); j <= Math.min(gridSize - 1, id + 1); j++) {
        if (apicCounts[j]) { hasNearby = true; break; }
      }
      if (id < 12 || (id >= 16 && id < 28)) hasNearby = true; // known core ranges
      if (hasNearby && !inGroup) { groupStart = id; inGroup = true; }
      if (!hasNearby && inGroup) { ccdGroups.push([groupStart, id - 1]); inGroup = false; }
    }
    if (inGroup) ccdGroups.push([groupStart, gridSize - 1]);

    // Build cells safely with DOM
    grid.textContent = '';

    for (var id = 0; id < gridSize; id++) {
      var cell = document.createElement('div');
      cell.className = 'apic-cell';

      // Determine which CCD group this ID belongs to
      var groupIdx = -1;
      for (var g = 0; g < ccdGroups.length; g++) {
        if (id >= ccdGroups[g][0] && id <= ccdGroups[g][1]) { groupIdx = g; break; }
      }

      var isInGroup = groupIdx >= 0;
      var isSecondary = groupIdx >= 1; // CCD1+ = secondary groups
      var count = apicCounts[id] || 0;

      if (!isInGroup) {
        cell.style.opacity = '0.15';
        cell.textContent = id;
        grid.appendChild(cell);
        continue;
      }

      if (isSecondary) cell.classList.add('ccd1');

      if (count > 0) {
        cell.classList.add('has-errors');
        var level = Math.min(5, Math.ceil((count / maxCount) * 5));
        cell.classList.add('heat-' + level);
      }

      cell.textContent = id;

      var tooltip = document.createElement('span');
      tooltip.className = 'apic-tooltip';
      var ccdLabel = 'CCD' + groupIdx;
      tooltip.textContent = count > 0
        ? 'APIC ' + id + ': ' + count + ' MCE' + (count > 1 ? 's' : '') + ' (' + ccdLabel + ')'
        : 'APIC ' + id + ' (' + ccdLabel + '): clean';
      cell.appendChild(tooltip);

      grid.appendChild(cell);
    }

    // Build legend dynamically from detected groups
    var legend = document.getElementById('apic-legend');
    legend.textContent = '';
    for (var g = 0; g < ccdGroups.length; g++) {
      var item = document.createElement('span');
      item.className = 'apic-legend-item';
      var swatch = document.createElement('span');
      swatch.className = 'apic-swatch ' + (g === 0 ? 'ccd0' : 'ccd1');
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(
        'CCD' + g + ' (' + ccdGroups[g][0] + '-' + ccdGroups[g][1] + ')'
      ));
      legend.appendChild(item);
    }
  }

  // ─── Chart ───
  drawChart() {
    const canvas = document.getElementById('chart');
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = 220 * dpr;
    canvas.style.height = '220px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = 220;
    const pad = { top: 20, right: 16, bottom: 32, left: 40 };
    const cW = W - pad.left - pad.right;
    const cH = H - pad.top - pad.bottom;

    // Clear
    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, W, H);

    let data = this.stability.slice();
    if (data.length === 0) {
      ctx.fillStyle = '#5a5e6e';
      ctx.font = '12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No stability data', W / 2, H / 2);
      return;
    }

    const now = Date.now();
    const ranges = { '24h': 86400000, '3d': 259200000, '7d': 604800000 };
    if (this.chartRange !== 'all' && ranges[this.chartRange]) {
      const cutoff = now - ranges[this.chartRange];
      data = data.filter(s => new Date(s.timestamp).getTime() >= cutoff);
      if (data.length === 0) data = [this.stability[this.stability.length - 1]];
    }

    const times = data.map(s => new Date(s.timestamp).getTime());
    const minT = Math.min.apply(null, times);
    const maxT = Math.max.apply(null, times);
    const rangeT = maxT - minT || 3600000;

    const toX = t => pad.left + ((t - minT) / rangeT) * cW;
    const toY = v => pad.top + cH - (v / 10) * cH;

    // Grid lines
    ctx.strokeStyle = '#252730';
    ctx.lineWidth = 1;
    for (let v = 0; v <= 10; v += 2) {
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#5a5e6e';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(v.toString(), pad.left - 6, y + 3);
    }

    // Danger zone (below 4)
    const y4 = toY(4);
    const yBot = toY(0);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.04)';
    ctx.fillRect(pad.left, y4, cW, yBot - y4);

    // Crash event vertical markers
    const crashEvents = this.events.filter(e =>
      (e.category === 'crash' && e.severity === 'critical') || e.category === 'hardware'
    );

    for (const e of crashEvents) {
      const t = new Date(e.timestamp).getTime();
      if (t < minT || t > maxT) continue;
      const x = toX(t);

      ctx.strokeStyle = e.category === 'hardware'
        ? 'rgba(245, 158, 11, 0.25)'
        : 'rgba(239, 68, 68, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + cH);
      ctx.stroke();

      ctx.fillStyle = e.category === 'hardware' ? '#f59e0b' : '#ef4444';
      ctx.fillRect(x - 1.5, pad.top - 4, 3, 4);
    }

    // Area fill under line
    if (data.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(toX(times[0]), toY(0));
      for (let i = 0; i < data.length; i++) {
        ctx.lineTo(toX(times[i]), toY(data[i].stabilityIndex));
      }
      ctx.lineTo(toX(times[times.length - 1]), toY(0));
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
      grad.addColorStop(0, 'rgba(74, 222, 128, 0.12)');
      grad.addColorStop(1, 'rgba(74, 222, 128, 0.01)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Stability line
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = toX(times[i]);
      const y = toY(data[i].stabilityIndex);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Colored segments for danger zones
    for (let i = 1; i < data.length; i++) {
      const val = data[i].stabilityIndex;
      if (val >= 7) continue;
      const x0 = toX(times[i - 1]);
      const y0 = toY(data[i - 1].stabilityIndex);
      const x1 = toX(times[i]);
      const y1 = toY(val);

      ctx.strokeStyle = val < 4 ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Current value dot with glow
    if (data.length > 0) {
      const lastI = data.length - 1;
      const lx = toX(times[lastI]);
      const ly = toY(data[lastI].stabilityIndex);
      const val = data[lastI].stabilityIndex;

      const dotColor = val < 4 ? '#ef4444' : val < 7 ? '#f59e0b' : '#4ade80';
      const glowColor = val < 4 ? 'rgba(239,68,68,0.3)' : val < 7 ? 'rgba(245,158,11,0.3)' : 'rgba(74,222,128,0.3)';

      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(lx, ly, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Time axis labels
    ctx.fillStyle = '#5a5e6e';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';

    const labelCount = Math.min(6, data.length);
    for (let i = 0; i <= labelCount; i++) {
      const t = minT + (rangeT * i / labelCount);
      const x = toX(t);
      const d = new Date(t);
      const label = rangeT < 172800000
        ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
        : d.getDate() + '/' + (d.getMonth() + 1);
      ctx.fillText(label, x, H - pad.bottom + 14);
    }

    // Store chart state for crosshair
    this.chartState = {
      W: W, H: H, pad: pad, cW: cW, cH: cH,
      minT: minT, maxT: maxT, rangeT: rangeT,
      data: data, times: times
    };
  }

  // ─── Event Log ───
  renderLog() {
    const tbody = document.getElementById('log-body');
    const filtered = this.events.filter(e => this.activeFilters.has(e.category));

    // Clear safely
    tbody.textContent = '';

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'log-loading';
      td.textContent = 'No events match filters';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const frag = document.createDocumentFragment();

    for (const e of filtered) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-ts', String(new Date(e.timestamp).getTime()));

      // Row class for severity highlighting
      if (e.severity === 'critical') tr.className = 'row-critical';
      else if (e.severity === 'error') tr.className = 'row-error';

      // Timestamp
      const tdTime = document.createElement('td');
      tdTime.className = 'log-time';
      tdTime.textContent = this.fmtTimestamp(e.timestamp);
      tr.appendChild(tdTime);

      // Severity dot
      const tdSev = document.createElement('td');
      tdSev.style.textAlign = 'center';
      const sevDot = document.createElement('span');
      sevDot.className = 'log-sev ' + e.severity;
      tdSev.appendChild(sevDot);
      tr.appendChild(tdSev);

      // Category badge
      const tdCat = document.createElement('td');
      const catBadge = document.createElement('span');
      catBadge.className = 'log-cat ' + e.category;
      catBadge.textContent = e.category.toUpperCase();
      tdCat.appendChild(catBadge);
      tr.appendChild(tdCat);

      // Title
      const tdTitle = document.createElement('td');
      tdTitle.className = 'log-title';
      tdTitle.textContent = e.title;
      tr.appendChild(tdTitle);

      // Detail
      const tdDetail = document.createElement('td');

      if (e.category === 'hardware' && e.description) {
        const apicMatch = e.description.match(/APIC[^:]*:\s*(\d+)/i) ||
                          e.description.match(/ID APIC[^:]*:\s*(\d+)/i);
        const errorType = e.description.match(/Type d'erreur\s*:\s*(.+)/i) ||
                          e.description.match(/Error Type\s*:\s*(.+)/i);

        if (apicMatch) {
          const apicSpan = document.createElement('span');
          apicSpan.className = 'log-apic';
          apicSpan.textContent = 'APIC ' + apicMatch[1];
          tdDetail.appendChild(apicSpan);
          tdDetail.appendChild(document.createTextNode(' '));
        }
        if (errorType) {
          const errSpan = document.createElement('span');
          errSpan.style.color = 'var(--txt-dim)';
          errSpan.textContent = errorType[1].trim();
          tdDetail.appendChild(errSpan);
        }
      } else {
        const descSpan = document.createElement('span');
        descSpan.className = 'log-desc';
        descSpan.textContent = e.description || '';
        descSpan.addEventListener('click', function () {
          this.classList.toggle('expanded');
        });
        tdDetail.appendChild(descSpan);
      }

      tr.appendChild(tdDetail);

      // Hover row → show marker on chart
      var self = this;
      tr.addEventListener('mouseenter', function () {
        var ts = this.getAttribute('data-ts');
        if (ts) self.drawOverlayMarker(parseInt(ts, 10));
      });
      tr.addEventListener('mouseleave', function () {
        self.clearOverlayMarker();
      });

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
  }

  drawOverlayMarker(eventTime) {
    var cs = this.chartState;
    if (!cs || cs.data.length === 0) return;

    // Skip if event is outside visible chart range
    if (eventTime < cs.minT || eventTime > cs.maxT) return;

    var overlay = document.getElementById('chart-overlay');
    var rect = overlay.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;

    overlay.width = rect.width * dpr;
    overlay.height = 220 * dpr;
    overlay.style.width = rect.width + 'px';
    overlay.style.height = '220px';

    var ctx = overlay.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cs.W, 220);

    var x = cs.pad.left + ((eventTime - cs.minT) / cs.rangeT) * cs.cW;

    // Vertical highlight line
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, cs.pad.top);
    ctx.lineTo(x, cs.pad.top + cs.cH);
    ctx.stroke();

    // Glow band around the line
    ctx.fillStyle = 'rgba(74, 222, 128, 0.08)';
    ctx.fillRect(x - 8, cs.pad.top, 16, cs.cH);

    // Diamond marker at the line position on the stability curve
    // Find nearest stability point to show the value
    var nearestIdx = 0;
    var nearestDist = Infinity;
    for (var i = 0; i < cs.times.length; i++) {
      var d = Math.abs(cs.times[i] - eventTime);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }

    var snapY = cs.pad.top + cs.cH - (cs.data[nearestIdx].stabilityIndex / 10) * cs.cH;

    // Diamond
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(x, snapY - 5);
    ctx.lineTo(x + 4, snapY);
    ctx.lineTo(x, snapY + 5);
    ctx.lineTo(x - 4, snapY);
    ctx.closePath();
    ctx.fill();

    // Time label at bottom
    var d = new Date(eventTime);
    var label = String(d.getDate()).padStart(2, '0') + '/' +
                String(d.getMonth() + 1).padStart(2, '0') + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0');

    ctx.fillStyle = '#4ade80';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, cs.pad.top + cs.cH + 14);
  }

  clearOverlayMarker() {
    var overlay = document.getElementById('chart-overlay');
    var ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  applyZoom(steps, idx) {
    var size = steps[idx];
    document.documentElement.style.setProperty('--zoom', size + 'px');
    var pct = Math.round((size / 14) * 100);
    document.getElementById('zoom-level').textContent = pct + '%';
    // Redraw chart since canvas doesn't scale with CSS
    if (this.chartState) this.drawChart();
  }

  // ─── Helpers ───
  fmtTimestamp(iso) {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return day + '/' + mon + ' ' + h + ':' + m + ':' + s;
  }

  fmtTime(d) {
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
  }
}

// Boot
window.addEventListener('DOMContentLoaded', function () {
  window._md = new MetalDoctor();
});
window.addEventListener('resize', function () {
  if (window._md) window._md.drawChart();
});
