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

// Nuvarande prestation: löptider (sekunder), måltid, 1RM och kroppsvikt.
const TIME_FIELDS = { time_5: '5 km', time_10: '10 km', time_21: 'Halvmaraton' };
const RM_FIELDS = { rm_squat: 'squat', rm_bench: 'bench', rm_deadlift: 'deadlift', rm_ohp: 'ohp' };

function readPerf(form) {
  const f = form.elements;
  const times = {};
  const invalid = [];
  for (const [field, distance] of Object.entries(TIME_FIELDS)) {
    if (!f[field].value.trim()) continue;
    const sec = Generator.parseTime(f[field].value);
    if (sec > 0) times[distance] = sec;
    else invalid.push(f[field]);
  }
  let goalTime = null;
  if (f.goalTime.value.trim() && !f.goalTime.closest('[hidden]')) {
    goalTime = Generator.parseTime(f.goalTime.value);
    if (!(goalTime > 0)) invalid.push(f.goalTime);
  }
  const oneRm = {};
  for (const [field, lift] of Object.entries(RM_FIELDS)) if (Number(f[field].value) > 0) oneRm[lift] = Number(f[field].value);
  return { times, goalTime, oneRm, bodyweight: Number(f.bodyweight.value) || null, invalid };
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

  // Vilka prestationsuppgifter som är relevanta beror på sporterna i programmet.
  const sport = f.sport.value;
  const mixOf = (k) => hybrid && Number(f[`mix_${k}`].value) > 0;
  const running = sport === 'lopning' || sport === 'hyrox' || mixOf('lopning') || mixOf('hyrox');
  const strength = sport === 'styrketraning' || sport === 'hyrox' || mixOf('styrka') || mixOf('hyrox');
  $('#perf-running').hidden = !running;
  $('#perf-strength').hidden = !strength;
  const distanceLabel = { '5 km': '5 km', '10 km': '10 km', Halvmaraton: 'halvmaraton', Maraton: 'maraton' }[f.distance.value];
  const showGoal = running && !$('#distance-field').hidden && f.purpose.value === 'tavling' && !!distanceLabel;
  $('#goal-time-field').hidden = !showGoal;
  $('#goal-time-label').textContent = `Måltid ${distanceLabel || ''}`.trim();

  const perf = readPerf(createForm);
  const knowsRunning = running && Object.keys(perf.times).length > 0;
  const knowsStrength = strength && perf.oneRm.squat && perf.bodyweight;
  // Erfarenhet behövs bara när nivån inte kan räknas ut (t.ex. cykling, eller inga tider ifyllda).
  $('#level-field').hidden = knowsRunning || (!running && knowsStrength);
  $('#level-hint').textContent = running || strength
    ? 'Fyll i uppgifterna ovan så räknas nivån ut automatiskt – annars välj här.'
    : '';
  const summary = $('#perf-summary');
  const text = knowsRunning ? Generator.describeRunning(perf.times, f.distance.value, perf.goalTime) : null;
  summary.textContent = text || '';
  summary.hidden = !text;

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
  if (!['goal', 'weeks'].includes(e.target.name)) syncCreateForm();
});
createForm.elements.startDate.value = todayISO();
syncCreateForm();

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = createForm.elements;
  const byDate = f.periodMode.value === 'date';
  const error = $('#create-error');
  const n = sessionCount(createForm);
  const perf = readPerf(createForm);
  createForm.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  perf.invalid.forEach((el) => el.classList.add('invalid'));
  const problem = byDate && f.targetDate.value <= f.startDate.value
    ? 'Måldatumet måste ligga efter startdatumet.'
    : n < 2 || n > Generator.MAX_SESSIONS
      ? `Välj mellan 2 och ${Generator.MAX_SESSIONS} pass i veckan.`
      : perf.invalid.length
        ? 'Kunde inte läsa en av tiderna. Skriv t.ex. 24:30 eller 1:52:00.'
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
    perf: { times: perf.times, goalTime: perf.goalTime, oneRm: perf.oneRm, bodyweight: perf.bodyweight },
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
      ${renderPerfInfo(p)}
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="muted small">${done} av ${total} pass klara (${pct} %)</p>
    </div>
    <details class="card tips">
      <summary>Tips för programmet</summary>
      <ul>${p.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </details>
    ${preview || !CONFIG.aiChat ? '' : renderChat(p)}
    <div class="weeks">${p.weekList.map((w, i) => renderWeek(w, i === current)).join('')}</div>
    ${preview ? '' : '<button type="button" class="btn danger" data-action="delete-program">Ta bort programmet</button>'}`;
}

// Tempon och 1RM som programmet räknats fram från.
const LIFT_NAMES = { squat: 'Knäböj', bench: 'Bänkpress', deadlift: 'Marklyft', ohp: 'Axelpress' };
function renderPerfInfo(p) {
  const rows = [];
  if (p.run) {
    const { easy, threshold, interval, race } = p.run.paces;
    rows.push(['Dina tempon', `Lugnt ${easy} · Tröskel ${threshold} · Intervall ${interval} · Tävlingsfart ${race}`]);
  }
  const rm = Object.entries(p.perf?.oneRm || {});
  if (rm.length) rows.push(['Ditt 1RM', rm.map(([k, v]) => `${LIFT_NAMES[k]} ${formatNumber(v)} kg`).join(' · ')]);
  return rows.length
    ? `<dl class="perf-info">${rows.map(([t, d]) => `<div><dt>${t}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>`
    : '';
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
      <button type="button" class="btn small ghost add-session" data-action="add-session" data-week="${w.number}">+ Lägg till pass</button>
    </details>`;
}

function renderSession(s) {
  const exercises = s.exercises
    ? `<ul class="exercises">${s.exercises.map((e) => `<li><span>${esc(e.name)}</span><span>${esc(e.sets)}${e.load ? ` <b>@ ${esc(e.load)}</b>` : ''}</span></li>`).join('')}</ul>`
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
          ${s.edited ? '<span class="edited">Ändrad</span>' : ''}
        </div>
        <p>${esc(s.description)}</p>
        ${exercises}
      </div>
      <div class="session-actions">
        ${button}
        <button type="button" class="btn small ghost edit-btn" data-action="edit" data-id="${s.id}" title="Redigera passet">Ändra</button>
      </div>
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
    await rerenderProgram();
  }
  if (action === 'edit' || action === 'add-session') {
    const program = await DataStore.getProgram(currentProgramId);
    const week = program.weekList.find((w) => w.number === Number(btn.dataset.week));
    openEditDialog(program, action === 'edit' ? findSession(program, id) : null, week);
  }
  if (action === 'delete-program' && confirm('Vill du ta bort programmet? Journalinläggen finns kvar.')) {
    await DataStore.deleteProgram(currentProgramId);
    location.hash = '#program';
  }
});

// Ritar om programmet men behåller vilka veckor som är uppfällda och var man har scrollat.
async function rerenderProgram() {
  const open = [...programView.querySelectorAll('details.week[open] [data-week]')].map((b) => b.dataset.week);
  const tipsOpen = programView.querySelector('details.tips')?.open;
  const scroll = window.scrollY;
  await renderPrograms(currentProgramId);
  programView.querySelectorAll('details.week').forEach((d) => {
    const week = d.querySelector('[data-week]')?.dataset.week;
    if (open.length) d.open = open.includes(week);
  });
  if (tipsOpen) programView.querySelector('details.tips').open = true;
  window.scrollTo(0, scroll);
}

// Sorterar veckans pass efter datum och numrerar dubbelpass ("Pass 1/2").
function sortWeek(week) {
  week.sessions.sort((a, b) => a.date.localeCompare(b.date) || (a.slot || 1) - (b.slot || 1));
  const perDay = {};
  week.sessions.forEach((s) => (perDay[s.date] = (perDay[s.date] || 0) + 1));
  const seen = {};
  week.sessions.forEach((s) => {
    s.slot = seen[s.date] = (seen[s.date] || 0) + 1;
    s.slots = perDay[s.date];
    s.day = (parseDate(s.date).getDay() + 6) % 7;
  });
}

const weekForDate = (program, date) =>
  program.weekList.find((w) => w.startDate <= date && date <= toISO(addDays(parseDate(w.startDate), 6)));

// ---- Redigera pass ----
const editDialog = $('#edit-dialog');
const editForm = $('#edit-form');
let editing = null; // { programId, sessionId } – sessionId saknas när ett nytt pass läggs till

function exerciseRow(e = {}) {
  return `
    <div class="exercise-row">
      <input name="ex_name" value="${esc(e.name)}" placeholder="Övning" aria-label="Övning" maxlength="60">
      <input name="ex_sets" value="${esc(e.sets)}" placeholder="3 × 10" aria-label="Set × reps" maxlength="30">
      <input name="ex_load" value="${esc(e.load)}" placeholder="Vikt, t.ex. 80 kg" aria-label="Vikt" maxlength="40">
      <button type="button" class="icon-btn" data-action="remove-exercise" title="Ta bort övningen">✕</button>
    </div>`;
}

function openEditDialog(program, session, week) {
  editing = { programId: program.id, sessionId: session?.id ?? null };
  const f = editForm.elements;
  editForm.reset();
  $('#edit-heading').textContent = session ? 'Ändra pass' : 'Lägg till pass';
  f.sessionTitle.value = session?.title ?? '';
  f.date.value = session?.date ?? week?.startDate ?? todayISO();
  f.date.min = program.weekList[0].startDate;
  f.date.max = toISO(addDays(parseDate(program.weekList[program.weekList.length - 1].startDate), 6));
  f.duration.value = session?.duration ?? '';
  f.intensity.value = session?.intensity ?? 'Medel';
  f.description.value = session?.description ?? '';
  $('#edit-exercises').innerHTML = (session?.exercises || []).map(exerciseRow).join('');
  editForm.querySelector('[data-action="delete-session"]').hidden = !session;
  $('#edit-error').hidden = true;
  editDialog.showModal();
}

editForm.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'close-edit') editDialog.close();
  if (action === 'add-exercise') {
    $('#edit-exercises').insertAdjacentHTML('beforeend', exerciseRow());
    $('#edit-exercises').lastElementChild.querySelector('input').focus();
  }
  if (action === 'remove-exercise') e.target.closest('.exercise-row').remove();
  if (action === 'delete-session' && confirm('Ta bort passet från programmet?')) {
    const program = await DataStore.getProgram(editing.programId);
    program.weekList.forEach((w) => {
      w.sessions = w.sessions.filter((s) => s.id !== editing.sessionId);
      sortWeek(w);
    });
    await DataStore.saveProgram(program);
    editDialog.close();
    await rerenderProgram();
  }
});

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = editForm.elements;
  const program = await DataStore.getProgram(editing.programId);
  const week = weekForDate(program, f.date.value);
  if (!week) {
    $('#edit-error').textContent = 'Datumet ligger utanför programmet.';
    $('#edit-error').hidden = false;
    return;
  }
  const exercises = [...editForm.querySelectorAll('.exercise-row')]
    .map((row) => ({
      name: row.querySelector('[name="ex_name"]').value.trim(),
      sets: row.querySelector('[name="ex_sets"]').value.trim(),
      load: row.querySelector('[name="ex_load"]').value.trim() || undefined,
    }))
    .filter((x) => x.name);
  const old = editing.sessionId ? findSession(program, editing.sessionId) : null;
  const updated = {
    ...(old || { id: uid(), type: 'egen', done: false }),
    title: f.sessionTitle.value.trim(),
    date: f.date.value,
    duration: f.duration.value ? Number(f.duration.value) : null,
    intensity: f.intensity.value,
    description: f.description.value.trim(),
    exercises: exercises.length ? exercises : undefined,
    edited: true,
  };
  // Ta bort det gamla passet (det kan ha flyttats till en annan vecka) och lägg in det nya.
  program.weekList.forEach((w) => (w.sessions = w.sessions.filter((s) => s.id !== updated.id)));
  week.sessions.push(updated);
  program.weekList.forEach(sortWeek);
  await DataStore.saveProgram(program);
  editDialog.close();
  await rerenderProgram();
});

// ---- AI-chatt ----
// Användaren beskriver en ändring, AI:n (Supabase-funktionen plan-chat) föreslår ändringar
// som visas här och bara genomförs när användaren godkänner dem.
const chat = { programId: null, messages: [], busy: false, open: false };

const dayLabel = (iso) => formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });

function renderChat(p) {
  if (chat.programId !== p.id) Object.assign(chat, { programId: p.id, messages: [], busy: false });
  const body = !DataStore.client
    ? '<p class="muted small">AI-chatten kräver inloggning.</p>'
    : `
      <div class="chat-log">
        ${chat.messages.length ? chat.messages.map(renderChatMessage).join('') : `
          <p class="muted small">Beskriv vad du vill ändra, t.ex. ”Byt tisdagens intervaller mot ett cykelpass på 60 min”,
          ”Jag kan inte träna på fredagar” eller ”Gör styrkepassen i vecka 3 lättare”. Du får se förslaget innan något ändras.</p>`}
        ${chat.busy ? '<div class="chat-msg assistant"><p class="thinking">Tänker…</p></div>' : ''}
      </div>
      <form class="chat-form" data-chat-form>
        <textarea name="message" rows="2" maxlength="2000" required placeholder="Vad vill du ändra?" ${chat.busy ? 'disabled' : ''}></textarea>
        <button type="submit" class="btn primary" ${chat.busy ? 'disabled' : ''}>Skicka</button>
      </form>`;
  return `
    <details class="card ai-chat" ${chat.open || chat.messages.length ? 'open' : ''}>
      <summary>Ändra med AI</summary>
      ${body}
    </details>`;
}

function renderChatMessage(m, index) {
  if (m.role === 'user') return `<div class="chat-msg user"><p>${esc(m.content)}</p></div>`;
  const changes = m.changes?.length ? `
    <ul class="chat-changes">${m.changes.map((c) => `<li class="change-${c.action}">${esc(c.label)}</li>`).join('')}</ul>
    ${m.status === 'pending' ? `
      <div class="chat-actions">
        <button type="button" class="btn small primary" data-action="chat-apply" data-index="${index}">Godkänn ändringarna</button>
        <button type="button" class="btn small ghost" data-action="chat-reject" data-index="${index}">Avvisa</button>
      </div>` : `<p class="chat-status">${m.status === 'applied' ? '✓ Ändringarna är genomförda' : 'Avvisat'}</p>`}` : '';
  return `<div class="chat-msg assistant${m.error ? ' error' : ''}"><p>${esc(m.content)}</p>${changes}</div>`;
}

// Kompakt version av programmet som skickas till AI:n.
function programForAI(p) {
  return {
    namn: p.name,
    mål: p.goal,
    syfte: LABELS.purpose[p.purpose],
    träningsform: LABELS.sport[p.sport],
    distans: p.distance || undefined,
    idag: todayISO(),
    tempon: p.run?.paces,
    oneRepMax: p.perf?.oneRm,
    veckor: p.weekList.map((w) => ({
      vecka: w.number,
      fas: LABELS.phase[w.phase] + (w.recovery ? ' (återhämtning)' : ''),
      sessions: w.sessions.map((s) => ({
        id: s.id,
        date: s.date,
        veckodag: formatDate(s.date, { weekday: 'long' }),
        title: s.title,
        duration: s.duration,
        intensity: s.intensity,
        description: s.description,
        exercises: s.exercises,
        klar: s.done || undefined,
      })),
    })),
  };
}

// Gör AI:ns ändringar läsbara, t.ex. "tis 4 nov: Intervaller → Cykelpass".
function describeChanges(program, changes) {
  return changes.map((c) => {
    const old = c.id ? findSession(program, c.id) : null;
    const s = c.session;
    let label;
    if (c.action === 'delete') label = old ? `Ta bort: ${dayLabel(old.date)} – ${old.title}` : 'Ta bort ett pass';
    else if (c.action === 'add') label = `Nytt pass: ${dayLabel(s.date)} – ${s.title}${s.duration ? ` (${s.duration} min)` : ''}`;
    else {
      const moved = old && s.date !== old.date ? ` (flyttas till ${dayLabel(s.date)})` : '';
      label = old ? `${dayLabel(old.date)}: ${old.title} → ${s.title}${moved}` : `Ändra: ${s.title}`;
    }
    return { ...c, label };
  });
}

function applyChanges(program, changes) {
  let skipped = 0;
  const fields = (s) => ({
    title: s.title,
    date: s.date,
    duration: s.duration ?? null,
    intensity: s.intensity,
    description: s.description,
    exercises: s.exercises?.length ? s.exercises.map((e) => ({ name: e.name, sets: e.sets, load: e.load || undefined })) : undefined,
    edited: true,
  });
  const remove = (id) => program.weekList.forEach((w) => (w.sessions = w.sessions.filter((x) => x.id !== id)));
  for (const c of changes) {
    const old = c.id ? findSession(program, c.id) : null;
    if (c.action === 'delete') {
      if (old) remove(old.id);
      else skipped++;
      continue;
    }
    const week = c.session && weekForDate(program, c.session.date);
    if (!week || (c.action === 'update' && !old)) {
      skipped++;
      continue;
    }
    if (old) remove(old.id);
    week.sessions.push(c.action === 'update'
      ? { ...old, ...fields(c.session) }
      : { id: uid(), type: 'egen', done: false, ...fields(c.session) });
  }
  program.weekList.forEach(sortWeek);
  return skipped;
}

// Läser felmeddelandet från funktionen om det finns ett.
async function functionError(error) {
  try {
    const body = await error.context.json();
    if (body?.error) return body.error;
  } catch { /* inget JSON-svar */ }
  return 'Kunde inte nå AI-chatten. Försök igen om en stund.';
}

async function sendChat(text) {
  const program = await DataStore.getProgram(chat.programId);
  const history = chat.messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
  chat.messages.push({ role: 'user', content: text });
  chat.busy = true;
  await rerenderProgram();
  try {
    const { data, error } = await DataStore.client.functions.invoke('plan-chat', {
      body: { message: text, program: programForAI(program), history },
    });
    if (error) throw new Error(await functionError(error));
    if (data?.error) throw new Error(data.error);
    const changes = describeChanges(program, data.changes || []);
    chat.messages.push({ role: 'assistant', content: data.reply, changes, status: changes.length ? 'pending' : null });
  } catch (err) {
    chat.messages.push({ role: 'assistant', content: err.message, error: true });
  }
  chat.busy = false;
  await rerenderProgram();
  programView.querySelector('.chat-log')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

programView.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-chat-form]')) return;
  e.preventDefault();
  const text = e.target.elements.message.value.trim();
  if (text && !chat.busy) await sendChat(text);
});

programView.addEventListener('keydown', (e) => {
  // Enter skickar, Shift+Enter ger ny rad.
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.chat-form textarea')) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

programView.addEventListener('toggle', (e) => {
  if (e.target.matches('details.ai-chat')) chat.open = e.target.open;
}, true);

programView.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="chat-apply"], [data-action="chat-reject"]');
  if (!btn) return;
  const m = chat.messages[Number(btn.dataset.index)];
  if (!m || m.status !== 'pending') return;
  if (btn.dataset.action === 'chat-apply') {
    const program = await DataStore.getProgram(chat.programId);
    const skipped = applyChanges(program, m.changes);
    await DataStore.saveProgram(program);
    if (skipped) toast(`${skipped} ändring(ar) kunde inte genomföras (passet fanns inte eller datumet låg utanför programmet).`, 'error');
    m.status = 'applied';
  } else {
    m.status = 'rejected';
  }
  await rerenderProgram();
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
    text: 'Berätta vad du vill uppnå – ett lopp, en tävling eller bättre form – och hur lång tid du har. Fitsphere bygger ett schema vecka för vecka, anpassat efter din nivå och hur ofta du vill träna.',
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
  if (location.hash.startsWith('#program/')) await rerenderProgram();
  else await route();
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
