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
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
}

async function route() {
  const loggedOut = Auth.needsLogin();
  $('#main-nav').hidden = loggedOut;
  $('#user-menu').hidden = loggedOut || !Auth.user;
  $('#user-email').textContent = Auth.user?.email ?? '';
  if (loggedOut) {
    showView('login');
    return;
  }

  const [view, id] = location.hash.slice(1).split('/');
  if (!['skapa', 'program', 'journal'].includes(view)) {
    const programs = await DataStore.getPrograms();
    location.replace(programs.length ? '#program' : '#skapa');
    return;
  }
  showView(view);
  if (view === 'program') await renderPrograms(id);
  if (view === 'journal') await renderJournal();
}
window.addEventListener('hashchange', () => route().then(() => window.scrollTo(0, 0)));

// ---- Skapa program ----
const createForm = $('#create-form');

function syncCreateForm() {
  const f = createForm.elements;
  const byDate = f.periodMode.value === 'date';
  $('#distance-field').hidden = f.sport.value !== 'lopning';
  $('#weeks-field').hidden = byDate;
  $('#date-field').hidden = !byDate;
  f.weeks.required = !byDate;
  f.targetDate.required = byDate;
  $('#date-label').textContent = f.purpose.value === 'tavling' ? 'Tävlingsdatum' : 'Måldatum';
}

createForm.addEventListener('change', syncCreateForm);
createForm.elements.startDate.value = todayISO();
syncCreateForm();

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = createForm.elements;
  const byDate = f.periodMode.value === 'date';
  const error = $('#create-error');
  if (byDate && f.targetDate.value <= f.startDate.value) {
    error.textContent = 'Måldatumet måste ligga efter startdatumet.';
    error.hidden = false;
    return;
  }
  error.hidden = true;

  const program = Generator.generate({
    purpose: f.purpose.value,
    sport: f.sport.value,
    distance: f.distance.value,
    goal: f.goal.value.trim(),
    level: f.level.value,
    sessionsPerWeek: f.sessionsPerWeek.value,
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

function renderProgramDetail(p) {
  const { total, done, pct } = programStats(p);
  const today = todayISO();
  let current = p.weekList.findIndex((w) => w.startDate <= today && today <= toISO(addDays(parseDate(w.startDate), 6)));
  if (current < 0) current = today < p.startDate ? 0 : -1;
  const chips = [
    LABELS.purpose[p.purpose],
    LABELS.sport[p.sport] + (p.distance ? ` · ${p.distance}` : ''),
    LABELS.level[p.level],
    `${p.sessionsPerWeek} pass/vecka`,
    `${p.weeks} veckor`,
  ];
  return `
    <a href="#program" class="back">← Alla program</a>
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
    <button type="button" class="btn danger" data-action="delete-program">Ta bort programmet</button>`;
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
  const today = todayISO();
  const weekAgo = toISO(addDays(new Date(), -6));
  const recent = entries.filter((e) => e.date >= weekAgo && e.date <= today);
  const minutes = recent.reduce((sum, e) => sum + (e.duration || 0), 0);
  const km = recent.reduce((sum, e) => sum + (e.distance || 0), 0);

  $('#journal-stats').innerHTML = `
    <div class="stat"><strong>${recent.length}</strong><span>pass senaste 7 dagarna</span></div>
    <div class="stat"><strong>${Math.floor(minutes / 60)} h ${minutes % 60} min</strong><span>träningstid senaste 7 dagarna</span></div>
    <div class="stat"><strong>${formatNumber(Math.round(km * 10) / 10)} km</strong><span>distans senaste 7 dagarna</span></div>
    <div class="stat"><strong>${entries.length}</strong><span>pass totalt</span></div>`;

  $('#journal-list').innerHTML = entries.length
    ? `<ul class="entries">${entries.map(renderEntry).join('')}</ul>`
    : '<p class="empty">Inga inlägg än. Logga ditt första pass med knappen ovan eller direkt från ett program.</p>';
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
  await // ---- Konto ----
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
