/* =====================================================
   Compound Interest Calculator — script.js
   Modes: growth | burndown | retire | waypoints
   ===================================================== */

// ─── State ───────────────────────────────────────────
let currentMode = 'growth';
let chartInstance = null;
let waypointCount = 0;

const defaultWaypoints = [
  { year: 0, monthly: 0 },
  { year: 1, monthly: 50 },
  { year: 5, monthly: 500 },
];

// ─── DOM refs ────────────────────────────────────────
const modeButtons    = document.querySelectorAll('.mode-btn');
const calcBtn        = document.getElementById('calculate-btn');
const addWaypointBtn = document.getElementById('add-waypoint-btn');
const waypointsList  = document.getElementById('waypoints-list');

// ─── Mode switching ──────────────────────────────────
modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    updateModeSections();
    calculate();
  });
});

function updateModeSections() {
  document.querySelectorAll('.mode-section').forEach(s => s.classList.add('hidden'));
  const active = document.getElementById(`section-${currentMode}`);
  if (active) active.classList.remove('hidden');

  document.getElementById('waypoints-breakdown').classList.add('hidden');
  document.getElementById('retire-breakdown').classList.add('hidden');

  if (currentMode === 'waypoints') document.getElementById('waypoints-breakdown').classList.remove('hidden');
  if (currentMode === 'retire')    document.getElementById('retire-breakdown').classList.remove('hidden');
}

// ─── Waypoint management ─────────────────────────────
function buildDefaultWaypoints() {
  defaultWaypoints.forEach(wp => addWaypointRow(wp.year, wp.monthly));
}

function addWaypointRow(year = '', monthly = 0) {
  waypointCount++;
  const row = document.createElement('div');
  row.className = 'waypoint-row';
  row.innerHTML = `
    <div>
      <div class="wp-label">Start Year</div>
      <input type="number" class="wp-year" min="0" value="${year}" placeholder="0" />
    </div>
    <div>
      <div class="wp-label">$/Month</div>
      <input type="number" class="wp-monthly" min="0" value="${monthly}" placeholder="0" />
    </div>
    <button class="btn-remove-wp" title="Remove">✕</button>
  `;
  row.querySelector('.btn-remove-wp').addEventListener('click', () => { row.remove(); calculate(); });
  row.querySelectorAll('input').forEach(i => i.addEventListener('input', calculate));
  waypointsList.appendChild(row);
}

addWaypointBtn.addEventListener('click', () => { addWaypointRow(); calculate(); });

// ─── Input helpers ────────────────────────────────────
function getNum(id) { return parseFloat(document.getElementById(id).value) || 0; }

function getWaypoints() {
  const rows = waypointsList.querySelectorAll('.waypoint-row');
  const wps = [];
  rows.forEach(row => {
    const yr = parseFloat(row.querySelector('.wp-year').value);
    const mo = parseFloat(row.querySelector('.wp-monthly').value) || 0;
    if (!isNaN(yr)) wps.push({ year: yr, monthly: mo });
  });
  return wps.sort((a, b) => a.year - b.year);
}

// ─── Core calculation engines ─────────────────────────

function calcGrowth(principal, annualRate, years, n, monthlyContrib) {
  const r = annualRate / 100 / n;
  const periods = Math.round(years * n);
  const contribPerPeriod = monthlyContrib * (12 / n);
  const data = [];
  let balance = principal, totalContrib = principal;
  data.push({ year: 0, balance, contributed: totalContrib, interest: 0 });
  for (let p = 1; p <= periods; p++) {
    balance = balance * (1 + r) + contribPerPeriod;
    totalContrib += contribPerPeriod;
    if (p % n === 0 || p === periods) {
      data.push({
        year: Math.round((p / n) * 10) / 10,
        balance: Math.max(0, balance),
        contributed: totalContrib,
        interest: Math.max(0, balance - totalContrib),
      });
    }
  }
  return data;
}

function calcBurndown(principal, annualRate, years, n, monthlyWithdraw) {
  const r = annualRate / 100 / n;
  const maxPeriods = Math.round(years * n);
  const withdrawPerPeriod = monthlyWithdraw * (12 / n);
  const data = [];
  let balance = principal, prevBalance = principal, zeroYear = null;
  data.push({ year: 0, balance, contributed: 0, interest: 0 });
  for (let p = 1; p <= maxPeriods; p++) {
    prevBalance = balance;
    balance = balance * (1 + r) - withdrawPerPeriod;
    if (balance <= 0 && zeroYear === null) {
      // Interpolate the fractional period where balance crossed zero
      const fraction = prevBalance / (prevBalance - balance); // 0–1 within this period
      zeroYear = (p - 1 + fraction) / n;
      data.push({ year: Math.round(zeroYear * 10) / 10, balance: 0, contributed: 0, interest: 0 });
      break;
    }
    if (p % n === 0 || p === maxPeriods) {
      data.push({ year: Math.round((p / n) * 10) / 10, balance: Math.max(0, balance), contributed: 0, interest: 0 });
    }
  }
  return { data, zeroYear };
}

function calcRetire(principal, annualRate, retireYear, endYear, n, monthlyContrib, monthlyWithdraw) {
  const r = annualRate / 100 / n;
  const contribPerPeriod  = monthlyContrib  * (12 / n);
  const withdrawPerPeriod = monthlyWithdraw * (12 / n);

  const data = [];
  let balance = principal, totalContrib = principal;
  let retireBalance = 0, zeroYear = null;

  data.push({ year: 0, balance, contributed: totalContrib, phase: 'grow' });

  // Phase 1: Accumulation
  const growPeriods = Math.round(retireYear * n);
  for (let p = 1; p <= growPeriods; p++) {
    balance = balance * (1 + r) + contribPerPeriod;
    totalContrib += contribPerPeriod;
    if (p % n === 0 || p === growPeriods) {
      data.push({
        year: Math.round((p / n) * 10) / 10,
        balance: Math.max(0, balance),
        contributed: totalContrib,
        phase: 'grow',
      });
    }
  }
  retireBalance = Math.max(0, balance);
  // Freeze contributions at retirement value for chart line
  const frozenContrib = totalContrib;

  // Phase 2: Drawdown
  const drawPeriods = Math.round((endYear - retireYear) * n);
  let prevBalance = balance;
  for (let p = 1; p <= drawPeriods; p++) {
    prevBalance = balance;
    balance = balance * (1 + r) - withdrawPerPeriod;
    const absYear = retireYear + p / n;

    if (balance <= 0 && zeroYear === null) {
      // Interpolate exact zero-crossing year
      const fraction = prevBalance / (prevBalance - balance);
      zeroYear = retireYear + (p - 1 + fraction) / n;
      data.push({
        year: Math.round(zeroYear * 10) / 10,
        balance: 0,
        contributed: frozenContrib,
        phase: 'draw',
      });
      break;
    }
    if (p % n === 0 || p === drawPeriods) {
      data.push({
        year: Math.round(absYear * 10) / 10,
        balance: Math.max(0, balance),
        contributed: frozenContrib,
        phase: 'draw',
      });
    }
  }

  const phases = [
    {
      label: '↑ Accumulation',
      startYr: 0,
      endYr: retireYear,
      monthly: `+${fmt(monthlyContrib)}/mo`,
      endBalance: retireBalance,
      type: 'grow',
    },
    {
      label: '↓ Withdrawal',
      startYr: retireYear,
      endYr: zeroYear != null ? Math.round(zeroYear * 10) / 10 : endYear,
      monthly: `-${fmt(monthlyWithdraw)}/mo`,
      endBalance: zeroYear != null ? 0 : Math.max(0, data[data.length - 1].balance),
      type: 'draw',
    },
  ];

  return { data, phases, retireBalance, zeroYear, totalContrib };
}

function calcWaypoints(principal, annualRate, years, n, waypoints) {
  const r = annualRate / 100 / n;
  const totalPeriods = Math.round(years * n);

  function getMonthlyAt(yr) {
    let contrib = 0;
    for (const wp of waypoints) { if (yr >= wp.year) contrib = wp.monthly; }
    return contrib;
  }

  const data = [];
  let balance = principal, totalContrib = principal;
  data.push({ year: 0, balance, contributed: totalContrib, interest: 0 });

  for (let p = 1; p <= totalPeriods; p++) {
    const currentYear = p / n;
    const monthly = getMonthlyAt(currentYear - 1 / n);
    const contribPerPeriod = monthly * (12 / n);
    balance = balance * (1 + r) + contribPerPeriod;
    totalContrib += contribPerPeriod;
    if (p % n === 0 || p === totalPeriods) {
      data.push({
        year: Math.round((p / n) * 10) / 10,
        balance: Math.max(0, balance),
        contributed: totalContrib,
        interest: Math.max(0, balance - totalContrib),
      });
    }
  }

  const phaseBoundaries = [...new Set([0, ...waypoints.map(wp => wp.year).filter(y => y > 0), years])].sort((a, b) => a - b);
  const phases = [];
  for (let i = 0; i < phaseBoundaries.length - 1; i++) {
    const startYr = phaseBoundaries[i], endYr = phaseBoundaries[i + 1];
    const monthly = getMonthlyAt(startYr);
    const startBal = data.find(d => d.year === startYr)?.balance ?? principal;
    const endBal   = data.find(d => d.year === endYr)?.balance ?? balance;
    phases.push({ label: `Phase ${i + 1}`, startYr, endYr, monthly, startBalance: startBal, endBalance: endBal });
  }

  return { data, phases };
}

// ─── Format helpers ───────────────────────────────────
function fmt(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return '$' + n.toFixed(2);
}

// ─── Chart rendering ──────────────────────────────────
function renderChart(labels, datasets, annotations) {
  const ctx = document.getElementById('mainChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#7a80a0',
            font: { family: 'DM Mono', size: 11 },
            boxWidth: 12,
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: '#ffffff',
          borderColor: '#e0e2ea',
          borderWidth: 1,
          titleColor: '#1a1d2e',
          bodyColor: '#7a80a0',
          titleFont: { family: 'DM Mono', size: 12 },
          bodyFont:  { family: 'DM Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#7a80a0',
            font: { family: 'DM Mono', size: 10 },
            maxTicksLimit: 12,
            callback: (val, idx) => `Yr ${labels[idx]}`,
          },
          grid: { color: '#f0f1f4' },
        },
        y: {
          ticks: {
            color: '#7a80a0',
            font: { family: 'DM Mono', size: 10 },
            callback: val => fmt(val),
          },
          grid: { color: '#f0f1f4' },
        }
      }
    }
  });
}

// ─── Update stats ─────────────────────────────────────
function resetStatLabels() {
  document.getElementById('stat-final').querySelector('.stat-label').textContent      = 'Final Value';
  document.getElementById('stat-contributed').querySelector('.stat-label').textContent = 'Total Contributed';
  document.getElementById('stat-interest').querySelector('.stat-label').textContent    = 'Interest Earned';
}

function setStats(finalVal, contributed, interestEarned, extraLabel, extraVal) {
  document.getElementById('val-final').textContent       = fmt(finalVal);
  document.getElementById('val-contributed').textContent = fmt(contributed);
  document.getElementById('val-interest').textContent    = fmt(interestEarned);
  document.getElementById('extra-label').textContent     = extraLabel;
  document.getElementById('val-extra').textContent       = extraVal;
}

// ─── Main calculate dispatcher ────────────────────────
function calculate() {
  const principal = getNum('principal');
  const rate      = getNum('rate');
  const years     = getNum('years');
  const n         = parseFloat(document.getElementById('compound-freq').value) || 12;

  resetStatLabels();

  if (currentMode === 'growth') {
    const monthly = getNum('monthly-contrib');
    const data    = calcGrowth(principal, rate, years, n, monthly);
    const labels  = data.map(d => d.year);
    const balances = data.map(d => d.balance);
    const contribs = data.map(d => d.contributed);
    const final    = balances[balances.length - 1];
    const totalContrib = contribs[contribs.length - 1];
    const totalInterest = data[data.length - 1].interest;

    renderChart(labels, [
      { label: 'Balance', data: balances, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.07)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
      { label: 'Contributions', data: contribs, borderColor: '#16a34a', backgroundColor: 'transparent', tension: 0.35, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] },
    ]);

    const multiple = totalContrib > 0 ? (final / totalContrib).toFixed(2) + '×' : '—';
    setStats(final, totalContrib, totalInterest, 'Growth Multiple', multiple);

  } else if (currentMode === 'burndown') {
    const withdraw = getNum('monthly-withdraw');
    const { data, zeroYear } = calcBurndown(principal, rate, years, n, withdraw);
    const labels   = data.map(d => d.year);
    const balances = data.map(d => d.balance);

    renderChart(labels, [
      { label: 'Balance', data: balances, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.07)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
    ]);

    const totalWithdrawn = withdraw * 12 * (zeroYear ?? years);
    document.getElementById('stat-final').querySelector('.stat-label').textContent      = 'Total Withdrawn';
    document.getElementById('stat-contributed').querySelector('.stat-label').textContent = 'Starting Balance';
    document.getElementById('stat-interest').querySelector('.stat-label').textContent    = 'Interest Consumed';
    document.getElementById('val-final').textContent       = fmt(totalWithdrawn);
    document.getElementById('val-contributed').textContent = fmt(principal);
    document.getElementById('val-interest').textContent    = zeroYear ? fmt(withdraw * 12 * zeroYear - principal) : '—';
    document.getElementById('extra-label').textContent     = 'Zero Year';
    document.getElementById('val-extra').textContent       = zeroYear ? `Yr ${zeroYear.toFixed(1)}` : `> Yr ${years}`;

  } else if (currentMode === 'retire') {
    const contrib     = getNum('retire-contrib');
    const retireYear  = getNum('retire-year');
    const withdraw    = getNum('retire-withdraw');
    const endYear     = Math.max(getNum('retire-end-year'), retireYear + 1);

    const { data, phases, retireBalance, zeroYear, totalContrib } = calcRetire(
      principal, rate, retireYear, endYear, n, contrib, withdraw
    );

    const labels   = data.map(d => d.year);
    const balances = data.map(d => d.balance);
    const contribs = data.map(d => d.contributed);

    // Split line into two color segments at retirement boundary
    const growBalances = data.map(d => d.phase === 'grow' ? d.balance : null);
    const drawBalances = data.map(d => d.phase === 'draw' ? d.balance : null);
    // Bridge: include the last grow point in draw series so lines connect
    const bridgeIdx = data.reduce((last, d, i) => d.phase === 'grow' ? i : last, -1);
    if (bridgeIdx >= 0) drawBalances[bridgeIdx] = data[bridgeIdx].balance;

    renderChart(labels, [
      { label: 'Accumulation', data: growBalances, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.07)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2, spanGaps: false },
      { label: 'Drawdown',     data: drawBalances, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.07)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2, spanGaps: false },
      { label: 'Contributions', data: contribs, borderColor: '#16a34a', backgroundColor: 'transparent', tension: 0.35, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] },
    ]);

    const finalBalance = data[data.length - 1].balance;
    const totalInterest = Math.max(0, retireBalance - totalContrib);

    document.getElementById('stat-final').querySelector('.stat-label').textContent      = 'Nest Egg Peak';
    document.getElementById('stat-contributed').querySelector('.stat-label').textContent = 'Total Contributed';
    document.getElementById('stat-interest').querySelector('.stat-label').textContent    = 'Interest (Accum.)';
    document.getElementById('val-final').textContent       = fmt(retireBalance);
    document.getElementById('val-contributed').textContent = fmt(totalContrib);
    document.getElementById('val-interest').textContent    = fmt(totalInterest);
    document.getElementById('extra-label').textContent     = 'Funds Zero';
    document.getElementById('val-extra').textContent       = zeroYear
      ? `Yr ${zeroYear.toFixed(1)}`
      : finalBalance > 0 ? `> Yr ${endYear}` : `Yr ${endYear}`;

    // Retire table
    const tbody = document.getElementById('retire-table-body');
    tbody.innerHTML = '';
    phases.forEach(ph => {
      const tr = document.createElement('tr');
      tr.className = ph.type === 'grow' ? 'phase-grow' : 'phase-draw';
      tr.innerHTML = `
        <td>${ph.label}</td>
        <td>${ph.startYr} → ${ph.endYr}</td>
        <td>${ph.monthly}</td>
        <td>${fmt(ph.endBalance)}</td>
      `;
      tbody.appendChild(tr);
    });

  } else if (currentMode === 'waypoints') {
    const wps = getWaypoints();
    if (wps.length === 0) return;

    const { data, phases } = calcWaypoints(principal, rate, years, n, wps);
    const labels   = data.map(d => d.year);
    const balances = data.map(d => d.balance);
    const contribs = data.map(d => d.contributed);
    const final    = balances[balances.length - 1];
    const totalContrib = contribs[contribs.length - 1];
    const totalInterest = data[data.length - 1].interest;
    const multiple = totalContrib > 0 ? (final / totalContrib).toFixed(2) + '×' : '—';

    renderChart(labels, [
      { label: 'Balance', data: balances, borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.07)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
      { label: 'Contributions', data: contribs, borderColor: '#2563eb', backgroundColor: 'transparent', tension: 0.35, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 3] },
    ]);

    setStats(final, totalContrib, totalInterest, 'Growth Multiple', multiple);

    const tbody = document.getElementById('wp-table-body');
    tbody.innerHTML = '';
    phases.forEach(ph => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${ph.label}</td>
        <td>${ph.startYr} → ${ph.endYr}</td>
        <td>${fmt(ph.monthly)}/mo</td>
        <td>${fmt(ph.endBalance)}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// ─── Live recalc ──────────────────────────────────────
document.querySelectorAll(
  '#principal,#rate,#years,#compound-freq,#monthly-contrib,#monthly-withdraw,' +
  '#retire-contrib,#retire-year,#retire-withdraw,#retire-end-year'
).forEach(el => el.addEventListener('input', calculate));

calcBtn.addEventListener('click', calculate);

// ─── Mobile inputs toggle ─────────────────────────────
(function () {
  const toggle = document.getElementById('inputs-toggle');
  const inner  = document.getElementById('inputs-inner');
  if (!toggle || !inner) return;

  function isMobile() { return window.innerWidth <= 600; }

  function applyToggleVisibility() {
    if (isMobile()) {
      toggle.style.display = 'flex';
    } else {
      toggle.style.display = 'none';
      inner.classList.remove('collapsed');
      toggle.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  toggle.addEventListener('click', () => {
    const isOpen = !inner.classList.contains('collapsed');
    if (isOpen) {
      inner.classList.add('collapsed');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      inner.classList.remove('collapsed');
      toggle.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  applyToggleVisibility();
  window.addEventListener('resize', applyToggleVisibility);
})();


buildDefaultWaypoints();
updateModeSections();
calculate();
