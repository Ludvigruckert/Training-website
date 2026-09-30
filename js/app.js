// Kopplar ihop gränssnittet med generatorn och datalagret.
const { LABELS, parseDate, toISO, addDays, uid } = Generator;
const FEELINGS = { 1: '😫', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
const INTENSITY_CLASS = { 'Låg': 'low', 'Medel': 'mid', 'Medel–hög': 'midhigh', 'Hög': 'high', 'Tävling': 'race' };

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const todayISO = () => toISO(new Date());
const formatDate = (iso, opts = { day: 'numeric', month: 'short' }) => parseDate(iso).toLocaleDateString('sv-SE', opts);
const formatNumber = (n) => String(n).replace('.', ',');

let currentProgramId = null;

// ---- Navigering ----
function showView(name, navName = name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === navName));
}

// Sidor som kräver inloggning (när Supabase är påslaget).
const PROTECTED = ['skapa', 'program', 'journal'];

async function route() {
  let [view, id] = location.hash.slice(1).split('/');
  if (![...PROTECTED, 'hem', 'login'].includes(view)) view = 'hem';

  const loggedOut = Auth.needsLogin();
  $('#main-nav').hidden = Auth.recovering;
  $('#user-menu').hidden = !Auth.user || Auth.recovering;
  $('#login-link').hidden = !loggedOut || Auth.recovering;
  $('#logout-button').title = Auth.user ? `Inloggad som ${Auth.user.email}` : '';

  if (Auth.recovering) view = 'login';
  // Utloggad på en skyddad sida: visa vad sidan gör, med en förhandsvisning.
  if (loggedOut && PROTECTED.includes(view)) {
    document.body.classList.remove('is-home');
    showView('teaser', view);
    renderTeaser(view);
    return;
  }
  if (view === 'login' && !loggedOut) {
    location.replace('#program');
    return;
  }
  if (view === 'login' && id === 'signup' && !Auth.recovering) Auth.setMode('signup');

  document.body.classList.toggle('is-home', view === 'hem');
  showView(view);
  if (view === 'hem') renderHome(loggedOut);
  if (view === 'program') await renderPrograms(id);
  if (view === 'journal') await renderJournal();
}
window.addEventListener('hashchange', () => route().then(() => window.scrollTo(0, 0)));

// ---- Startsida ----
function renderHome(loggedOut) {
  const [primary, secondary] = [$('#hero-primary'), $('#hero-secondary')];
  if (loggedOut) {
    primary.href = '#login/signup';
    primary.textContent = 'Kom igång – det är gratis';
    secondary.href = '#login';
    secondary.textContent = 'Logga in';
  } else {
    primary.href = '#skapa';
    primary.textContent = 'Skapa ett program';
    secondary.href = '#program';
    secondary.textContent = 'Mina program';
  }
}

// Bakgrundsbilderna tonar över till nästa bild var sjätte sekund.
const slides = document.querySelectorAll('.hero-slide');
let slideIndex = 0;
setInterval(() => {
  if (document.hidden || $('#view-hem').hidden) return;
  slides[slideIndex].classList.remove('active');
  slideIndex = (slideIndex + 1) % slides.length;
  slides[slideIndex].classList.add('active');
}, 6000);

// ---- Skapa program ----
const createForm = $('#create-form');

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

// Knappar för fasta veckodagar för egna sporter.
document.querySelectorAll('[data-weekdays]').forEach((group) => {
  group.innerHTML = WEEKDAYS.map((d, i) =>
    `<label class="weekday"><input type="checkbox" name="extra_day" value="${i}"><span>${d}</span></label>`).join('');
});

// Hybridprogrammets val: antal pass per sort och egna sporter (med ev. fasta dagar).
function readMix(form) {
  const mix = Object.fromEntries(Generator.MIX_ORDER.map((k) => [k, Number(form.elements[`mix_${k}`].value) || 0]));
  const extras = [...form.querySelectorAll('[data-extra]')]
    .map((row) => {
      const days = [...row.querySelectorAll('[name="extra_day"]:checked')].map((el) => Number(el.value));
      const count = days.length || Number(row.querySelector('[name="extra_count"]').value) || 0;
      return { name: row.querySelector('[name="extra_name"]').value.trim(), count, days };
    })
    .filter((e) => e.name && e.count);
  return { mix, extras };
}

// Antal olika fasta dagar – så många träningsdagar behövs minst.
const fixedDayCount = (extras) => new Set(extras.flatMap((e) => e.days)).size;

function sessionCount(form) {
  if (form.elements.sport.value !== 'hybrid') return Number(form.elements.sessionsPerWeek.value);
  const { mix, extras } = readMix(form);
  return Generator.mixTotal(mix, extras);
}

// Fyller i valen för träningsdagar (högst två pass per dag) och returnerar valt antal.
function fillDays(select, n, preferred, fixedCount = 0) {
  const range = Generator.dayRange(Math.min(Math.max(n, 1), Generator.MAX_SESSIONS), fixedCount);
  const value = preferred >= range.min && preferred <= range.max ? preferred : range.default;
  select.innerHTML = '';
  for (let d = range.min; d <= range.max; d++) select.add(new Option(String(d), String(d), d === value, d === value));
  return value;
}

let daysTouched = false;

function syncCreateForm() {
  const f = createForm.elements;
  const byDate = f.periodMode.value === 'date';
  const hybrid = f.sport.value === 'hybrid';
  const n = sessionCount(createForm);

  $('#mix-field').hidden = !hybrid;
  $('#sessions-field').hidden = hybrid;
  $('#distance-field').hidden = !(f.sport.value === 'lopning' || (hybrid && Number(f.mix_lopning.value) > 0));
  $('#weeks-field').hidden = byDate;
  $('#date-field').hidden = !byDate;
  f.weeks.required = !byDate;
  f.targetDate.required = byDate;
  $('#date-label').textContent = f.purpose.value === 'tavling' ? 'Tävlingsdatum' : 'Måldatum';

  const total = $('#mix-total');
  total.textContent = n > Generator.MAX_SESSIONS
    ? `Totalt ${n} pass – högst ${Generator.MAX_SESSIONS} pass i veckan går att planera.`
    : n < 2 ? 'Välj minst 2 pass i veckan.' : `Totalt ${n} pass i veckan.`;
  total.classList.toggle('error', n < 2 || n > Generator.MAX_SESSIONS);

  // Med fasta dagar räknas antalet pass fram från dagarna.
  createForm.querySelectorAll('[data-extra]').forEach((row) => {
    const checked = row.querySelectorAll('[name="extra_day"]:checked').length;
    const count = row.querySelector('[name="extra_count"]');
    count.readOnly = checked > 0;
    if (checked) count.value = checked;
  });
  const fixed = hybrid ? fixedDayCount(readMix(createForm).extras) : 0;
  const days = fillDays(f.days, n, daysTouched ? Number(f.days.value) : null, fixed);
  const doubles = Math.max(0, Math.min(n, Generator.MAX_SESSIONS) - days);
  $('#days-hint').textContent = doubles
    ? `${doubles} ${doubles === 1 ? 'dag' : 'dagar'} med två pass`
    : 'Ett pass per dag';
}

createForm.addEventListener('change', (e) => {
  if (e.target.name === 'days') daysTouched = true;
  syncCreateForm();
});
createForm.addEventListener('input', (e) => {
  if (e.target.type === 'number' && e.target.name !== 'weeks') syncCreateForm();
});
createForm.elements.startDate.value = todayISO();
syncCreateForm();

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = createForm.elements;
  const byDate = f.periodMode.value === 'date';
  const error = $('#create-error');
  const n = sessionCount(createForm);
  const problem = byDate && f.targetDate.value <= f.startDate.value
    ? 'Måldatumet måste ligga efter startdatumet.'
    : n < 2 || n > Generator.MAX_SESSIONS
      ? `Välj mellan 2 och ${Generator.MAX_SESSIONS} pass i veckan.`
      : null;
  error.textContent = problem || '';
  error.hidden = !problem;
  if (problem) return;

  const program = Generator.generate({
    purpose: f.purpose.value,
    sport: f.sport.value,
    distance: f.distance.value,
    goal: f.goal.value.trim(),
    level: f.level.value,
    sessionsPerWeek: f.sessionsPerWeek.value,
    days: f.days.value,
    ...(f.sport.value === 'hybrid' ? readMix(createForm) : {}),
    startDate: f.startDate.value,
    weeks: byDate ? null : f.weeks.value,
    targetDate: byDate ? f.targetDate.value : null,
  });
  await DataStore.saveProgram(program);
  location.hash = `#program/${program.id}`;
});

// ---- Mina program ----
const programView = $('#view-program');

function programStats(p) {
  const sessions = p.weekList.flatMap((w) => w.sessions);
  const done = sessions.filter((s) => s.done).length;
  return { total: sessions.length, done, pct: sessions.length ? Math.round((done / sessions.length) * 100) : 0 };
}

async function renderPrograms(id) {
  currentProgramId = id || null;
  if (id) {
    const program = await DataStore.getProgram(id);
    programView.innerHTML = program
      ? renderProgramDetail(program)
      : '<p class="empty">Programmet hittades inte. <a href="#program">Tillbaka</a></p>';
    return;
  }
  const programs = await DataStore.getPrograms();
  programView.innerHTML = `
    <div class="view-head">
      <h1>Mina program</h1>
      <a class="btn primary" href="#skapa">+ Nytt program</a>
    </div>
    ${programs.length
      ? programs.map(renderProgramCard).join('')
      : '<p class="empty">Du har inga program än. <a href="#skapa">Skapa ditt första!</a></p>'}`;
}

function renderProgramCard(p) {
  const { pct } = programStats(p);
  const yearOpts = { day: 'numeric', month: 'short', year: 'numeric' };
  return `
    <a class="card program-card" href="#program/${p.id}">
      <div>
        <h2>${esc(p.name)}</h2>
        <p class="muted">${LABELS.sport[p.sport]} · ${p.weeks} veckor · ${formatDate(p.startDate, yearOpts)} – ${formatDate(p.endDate, yearOpts)}</p>
        <div class="progress"><div style="width:${pct}%"></div></div>
      </div>
      <span class="pct">${pct} %</span>
    </a>`;
}

function renderProgramDetail(p, preview = false) {
  const { total, done, pct } = programStats(p);
  const today = todayISO();
  let current = p.weekList.findIndex((w) => w.startDate <= today && today <= toISO(addDays(parseDate(w.startDate), 6)));
  if (current < 0) current = today < p.startDate ? 0 : -1;
  // Hybrid: "4 löpning · 2 styrka · 1 padel"
  const mix = p.mix
    ? [
      ...Generator.MIX_ORDER.filter((k) => p.mix[k]).map((k) => `${p.mix[k]} ${LABELS.discipline[k].toLowerCase()}`),
      ...(p.extras || []).map((e) => `${e.count} ${e.name.toLowerCase()}`
        + (e.days?.length ? ` (${e.days.map((d) => WEEKDAYS[d].toLowerCase()).join(', ')})` : '')),
    ].join(' · ')
    : null;
  const chips = [
    LABELS.purpose[p.purpose],
    LABELS.sport[p.sport] + (p.distance ? ` · ${p.distance}` : ''),
    mix,
    LABELS.level[p.level],
    `${p.sessionsPerWeek} pass/vecka` + (p.days && p.days < p.sessionsPerWeek ? ` på ${p.days} dagar` : ''),
    `${p.weeks} veckor`,
  ].filter(Boolean);
  return `
    ${preview ? '' : '<a href="#program" class="back">← Alla program</a>'}
    <div class="card program-head">
      <h1>${esc(p.name)}</h1>
      <p class="muted">${formatDate(p.startDate, { day: 'numeric', month: 'long', year: 'numeric' })} – ${formatDate(p.endDate, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="muted small">${done} av ${total} pass klara (${pct} %)</p>
    </div>
    <details class="card tips">
      <summary>Tips för programmet</summary>
      <ul>${p.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </details>
    <div class="weeks">${p.weekList.map((w, i) => renderWeek(w, i === current)).join('')}</div>
    ${preview ? '' : '<button type="button" class="btn danger" data-action="delete-program">Ta bort programmet</button>'}`;
}

function renderWeek(w, isCurrent) {
  const done = w.sessions.filter((s) => s.done).length;
  return `
    <details class="week${isCurrent ? ' current' : ''}" ${isCurrent ? 'open' : ''}>
      <summary>
        <span class="week-num">Vecka ${w.number}</span>
        <span class="phase phase-${w.phase}">${LABELS.phase[w.phase]}${w.recovery ? ' · återhämtning' : ''}</span>
        <span class="week-date">${formatDate(w.startDate)}</span>
        <span class="week-done">${done}/${w.sessions.length}</span>
      </summary>
      <ul class="sessions">${w.sessions.map(renderSession).join('')}</ul>
    </details>`;
}

function renderSession(s) {
  const exercises = s.exercises
    ? `<ul class="exercises">${s.exercises.map((e) => `<li><span>${esc(e.name)}</span><span>${esc(e.sets)}</span></li>`).join('')}</ul>`
    : '';
  const button = s.done
    ? `<button type="button" class="btn small done" data-action="undo" data-id="${s.id}" title="Markera som ej klar">✓ Klar</button>`
    : `<button type="button" class="btn small" data-action="log" data-id="${s.id}">Logga</button>`;
  return `
    <li class="session${s.done ? ' is-done' : ''}">
      <div class="session-day">
        <strong>${formatDate(s.date, { weekday: 'short' })}</strong>
        <span>${formatDate(s.date)}</span>
        ${s.slots > 1 ? `<span class="slot">Pass ${s.slot}</span>` : ''}
      </div>
      <div class="session-body">
        <div class="session-head">
          <h3>${esc(s.title)}</h3>
          <span class="tag tag-${INTENSITY_CLASS[s.intensity] || 'mid'}">${esc(s.intensity)}</span>
          ${s.duration ? `<span class="dur">${s.duration} min</span>` : ''}
        </div>
        <p>${esc(s.description)}</p>
        ${exercises}
      </div>
      ${button}
    </li>`;
}

function findSession(program, sessionId) {
  for (const w of program.weekList) {
    const s = w.sessions.find((x) => x.id === sessionId);
    if (s) return s;
  }
  return null;
}

async function setSessionDone(programId, sessionId, done) {
  const program = await DataStore.getProgram(programId);
  const s = program && findSession(program, sessionId);
  if (!s) return;
  s.done = done;
  await DataStore.saveProgram(program);
}

programView.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !currentProgramId) return;
  const { action, id } = btn.dataset;

  if (action === 'log') {
    const program = await DataStore.getProgram(currentProgramId);
    const s = findSession(program, id);
    openLogDialog({ programId: program.id, sessionId: s.id, date: s.date, activity: s.title, duration: s.duration });
  }
  if (action === 'undo') {
    await setSessionDone(currentProgramId, id, false);
    await renderPrograms(currentProgramId);
  }
  if (action === 'delete-program' && confirm('Vill du ta bort programmet? Journalinläggen finns kvar.')) {
    await DataStore.deleteProgram(currentProgramId);
    location.hash = '#program';
  }
});

// ---- Journal ----
async function renderJournal() {
  const entries = await DataStore.getJournal();
  $('#journal-stats').innerHTML = renderJournalStats(entries);
  $('#journal-list').innerHTML = entries.length
    ? `<ul class="entries">${entries.map(renderEntry).join('')}</ul>`
    : '<p class="empty">Inga inlägg än. Logga ditt första pass med knappen ovan eller direkt från ett program.</p>';
}

function renderJournalStats(entries) {
  const today = todayISO();
  const weekAgo = toISO(addDays(new Date(), -6));
  const recent = entries.filter((e) => e.date >= weekAgo && e.date <= today);
  const minutes = recent.reduce((sum, e) => sum + (e.duration || 0), 0);
  const km = recent.reduce((sum, e) => sum + (e.distance || 0), 0);

  return `
    <div class="stat"><strong>${recent.length}</strong><span>pass senaste 7 dagarna</span></div>
    <div class="stat"><strong>${Math.floor(minutes / 60)} h ${minutes % 60} min</strong><span>träningstid senaste 7 dagarna</span></div>
    <div class="stat"><strong>${formatNumber(Math.round(km * 10) / 10)} km</strong><span>distans senaste 7 dagarna</span></div>
    <div class="stat"><strong>${entries.length}</strong><span>pass totalt</span></div>`;
}

function renderEntry(e) {
  const meta = [
    e.duration ? `${e.duration} min` : null,
    e.distance ? `${formatNumber(e.distance)} km` : null,
  ].filter(Boolean).join(' · ');
  return `
    <li class="card entry">
      <div class="entry-feeling" title="Känsla">${FEELINGS[e.feeling] || '·'}</div>
      <div class="entry-body">
        <div class="entry-head">
          <h3>${esc(e.activity)}</h3>
          <span class="muted small">${formatDate(e.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        ${meta ? `<p class="muted small">${meta}</p>` : ''}
        ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
      </div>
      <button type="button" class="icon-btn" data-action="delete-entry" data-id="${e.id}" title="Ta bort">✕</button>
    </li>`;
}

$('#view-journal').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'new-entry') openLogDialog();
  if (btn.dataset.action === 'delete-entry' && confirm('Ta bort inlägget?')) {
    const removed = await DataStore.deleteEntry(btn.dataset.id);
    if (removed?.programId) await setSessionDone(removed.programId, removed.sessionId, false);
    await renderJournal();
  }
});

// ---- Presentationssidor (utloggad) ----
const TEASERS = {
  skapa: {
    title: 'Skapa ett träningsprogram',
    text: 'Berätta vad du vill uppnå – ett lopp, en tävling eller bättre form – och hur lång tid du har. Planfit bygger ett schema vecka för vecka, anpassat efter din nivå och hur ofta du vill träna.',
    points: [
      'Löpning, cykling, Hyrox, styrketräning – eller hybrid där du blandar fritt',
      'Välj antal veckor – eller räkna bakåt från tävlingsdagen',
      '2–12 pass i veckan, gärna två pass samma dag',
    ],
  },
  program: {
    title: 'Mina program',
    text: 'Här följer du dina program vecka för vecka. Varje pass har tid, intensitet och en beskrivning av vad du ska göra – och du bockar av passen när de är klara.',
    points: [
      'Faser: bas, uppbyggnad, toppform och nedtrappning',
      'Återhämtningsveckor inbyggda',
      'Se hur stor del av programmet du har klarat',
    ],
  },
  journal: {
    title: 'Träningsjournal',
    text: 'Logga dina pass på några sekunder – tid, distans, hur det kändes och en anteckning. Du ser direkt hur mycket du har tränat den senaste veckan.',
    points: [
      'Logga direkt från programmet eller fristående pass',
      'Känsla från 😫 till 😄 för att se mönster över tid',
      'Veckosammanfattning med pass, tid och distans',
    ],
  },
};

// Exempelprogram som startade förra måndagen, så att "denna vecka" visas uppfälld.
function demoProgram() {
  const lastMonday = addDays(new Date(), -((new Date().getDay() + 6) % 7) - 7);
  const p = Generator.generate({
    purpose: 'tavling', sport: 'lopning', distance: 'Halvmaraton', goal: 'Göteborgsvarvet',
    level: 'van', sessionsPerWeek: 4, startDate: toISO(lastMonday), weeks: 12,
  });
  const today = todayISO();
  p.weekList.flatMap((w) => w.sessions).forEach((s) => (s.done = s.date < today));
  return { ...p, weekList: p.weekList.slice(0, 3) };
}

function demoJournal() {
  const day = (n) => toISO(addDays(new Date(), -n));
  return [
    { id: 'd1', createdAt: '', date: day(1), activity: 'Långpass', duration: 85, distance: 14.2, feeling: 5, note: 'Kändes starkt hela vägen – sista 3 km i tävlingsfart.' },
    { id: 'd2', createdAt: '', date: day(3), activity: 'Intervaller', duration: 50, distance: 9.1, feeling: 3, note: '5 × 4 min. Tungt på slutet men höll farten.' },
    { id: 'd3', createdAt: '', date: day(4), activity: 'Styrka & core', duration: 30, distance: null, feeling: 4, note: '' },
    { id: 'd4', createdAt: '', date: day(6), activity: 'Lugnt pass', duration: 45, distance: 7.8, feeling: 2, note: 'Sov dåligt, benen kändes sega.' },
  ];
}

function renderTeaser(view) {
  const t = TEASERS[view];
  const container = $('#view-teaser');
  container.innerHTML = `
    <div class="teaser-head">
      <h1>${t.title}</h1>
      <p class="lead">${t.text}</p>
      <ul class="checklist">${t.points.map((p) => `<li>${p}</li>`).join('')}</ul>
      <div class="hero-actions">
        <a class="btn primary" href="#login/signup">Skapa konto gratis</a>
        <a class="btn" href="#login">Logga in</a>
      </div>
    </div>
    <div class="preview${view === 'skapa' ? ' tall' : ''}" inert>
      <span class="preview-label">Exempel</span>
      <div class="preview-body"></div>
    </div>`;
  const body = $('.preview-body', container);

  if (view === 'skapa') {
    // En ifylld kopia av det riktiga formuläret, följt av resultatet.
    const form = createForm.cloneNode(true);
    form.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    const f = form.elements;
    Object.assign(f.purpose, { value: 'tavling' });
    Object.assign(f.sport, { value: 'lopning' });
    Object.assign(f.distance, { value: 'Halvmaraton' });
    Object.assign(f.goal, { value: 'Göteborgsvarvet' });
    Object.assign(f.weeks, { value: '12' });
    Object.assign(f.sessionsPerWeek, { value: '4' });
    fillDays(f.days, 4, 4);
    form.querySelector('small.hint').replaceChildren('Ett pass per dag');
    form.querySelector('fieldset.mix').hidden = true;
    f.sessionsPerWeek.closest('.field').hidden = false;
    f.distance.closest('.field').hidden = false;
    body.append(form);
    const demo = demoProgram();
    const current = demo.weekList.find((w) => w.sessions.some((s) => !s.done)) || demo.weekList[0];
    body.insertAdjacentHTML('beforeend', `
      <p class="preview-arrow">↓ Blir ett schema vecka för vecka</p>
      <div class="weeks">${renderWeek(current, true)}</div>`);
  }
  if (view === 'program') body.innerHTML = renderProgramDetail(demoProgram(), true);
  if (view === 'journal') {
    const entries = demoJournal();
    body.innerHTML = `
      <div class="stats">${renderJournalStats(entries)}</div>
      <ul class="entries">${entries.map(renderEntry).join('')}</ul>`;
  }
}

// ---- Logga-dialogen ----
const logDialog = $('#log-dialog');
const logForm = $('#log-form');

function openLogDialog(prefill = {}) {
  logForm.reset();
  const f = logForm.elements;
  f.date.value = prefill.date || todayISO();
  f.activity.value = prefill.activity || '';
  f.duration.value = prefill.duration || '';
  f.programId.value = prefill.programId || '';
  f.sessionId.value = prefill.sessionId || '';
  logDialog.showModal();
}

logForm.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-dialog"]')) logDialog.close();
});

logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = logForm.elements;
  const entry = {
    id: uid(),
    createdAt: new Date().toISOString(),
    date: f.date.value,
    activity: f.activity.value.trim(),
    duration: f.duration.value ? Number(f.duration.value) : null,
    distance: f.distance.value ? Number(f.distance.value) : null,
    feeling: f.feeling.value ? Number(f.feeling.value) : null,
    note: f.note.value.trim(),
    programId: f.programId.value || null,
    sessionId: f.sessionId.value || null,
  };
  await DataStore.addEntry(entry);
  if (entry.programId) await setSessionDone(entry.programId, entry.sessionId, true);
  logDialog.close();
  await route();
});

// ---- Konto ----
$('#user-menu').addEventListener('click', async (e) => {
  if (e.target.closest('[data-action="logout"]')) await Auth.signOut();
});

// Erbjud att flytta data som sparats i webbläsaren innan inloggning fanns.
async function offerImport() {
  if (!DataStore.localCounts) return;
  const { programs, entries } = DataStore.localCounts();
  if (!programs && !entries) return;
  const ok = confirm(`Du har ${programs} program och ${entries} journalinlägg sparade i den här webbläsaren. Vill du flytta dem till ditt konto?`);
  if (!ok) return;
  await DataStore.importLocal();
  toast('Klart! Datan finns nu på ditt konto.');
}

// ---- Meddelanden ----
let toastTimer;
function toast(text, type = 'success') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`Något gick fel: ${e.reason?.message || e.reason}`, 'error');
});

Auth.init(async (justSignedIn) => {
  if (justSignedIn) await offerImport();
  await route();
}).then(route);
