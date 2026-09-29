// Genererar träningsprogram utifrån syfte, träningsform, tidsperiod och nivå.
// Regelbaserat: veckorna delas in i faser (bas → uppbyggnad → topp → nedtrappning)
// och varje vecka fylls med pass som passar fasen.
const Generator = (() => {
  const LABELS = {
    purpose: {
      tavling: 'Tävling / lopp',
      kondition: 'Bättre kondition',
      styrka: 'Bli starkare',
      muskler: 'Bygga muskler',
      viktnedgang: 'Gå ner i vikt',
      halsa: 'Allmän hälsa',
    },
    sport: {
      lopning: 'Löpning',
      cykling: 'Cykling',
      langdskidor: 'Längdskidor',
      simning: 'Simning',
      styrketraning: 'Styrketräning',
      blandat: 'Blandat',
    },
    level: { nyborjare: 'Nybörjare', van: 'Van', avancerad: 'Avancerad' },
    phase: { bas: 'Basperiod', uppbyggnad: 'Uppbyggnad', topp: 'Toppform', nedtrappning: 'Nedtrappning' },
  };

  // Vilka veckodagar passen läggs på (0 = måndag). Sista dagen får långpasset.
  const DAY_PATTERNS = {
    2: [1, 5],
    3: [0, 2, 5],
    4: [0, 1, 3, 5],
    5: [0, 1, 3, 4, 6],
    6: [0, 1, 2, 3, 5, 6],
  };
  const ACTIVITY = {
    lopning: 'Löpning',
    cykling: 'Cykling',
    langdskidor: 'Skidåkning eller rullskidor',
    simning: 'Simning',
  };
  const TESTS = {
    lopning: 'Spring 5 km så snabbt du orkar och notera tiden.',
    cykling: 'Cykla 20 min så hårt du kan hålla jämnt och notera sträckan.',
    langdskidor: 'Åk en slinga du känner till i hög fart och notera tiden.',
    simning: 'Simma 400 m så snabbt du kan och notera tiden.',
  };
  const BASE_MINUTES = { nyborjare: 30, van: 45, avancerad: 55 };
  const LEVEL_STEP = { nyborjare: 0, van: 1, avancerad: 2 };
  const LONG_CAP = { '5 km': 75, '10 km': 95, Halvmaraton: 135, Maraton: 180 };

  // ---- Hjälpfunktioner ----
  function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
  function mondayOf(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - weekday(r));
    return r;
  }
  function weekday(d) {
    return (d.getDay() + 6) % 7;
  }
  function weeksUntil(startStr, targetStr) {
    const days = Math.round((parseDate(targetStr) - mondayOf(parseDate(startStr))) / 86400000);
    return clamp(Math.floor(days / 7) + 1, 1, 52);
  }
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  // UUID v4 – databasen kräver det formatet.
  const uid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

  const session = (day, type, title, duration, intensity, description, extra = {}) => ({
    day,
    type,
    title,
    duration,
    intensity,
    description,
    ...extra,
  });

  // ---- Faser och belastning ----
  function buildPhases(weeks, isRace) {
    const taper = isRace && weeks >= 3 ? (weeks >= 12 ? 2 : 1) : 0;
    const rest = weeks - taper;
    const base = Math.max(1, Math.round(rest * 0.45));
    const build = Math.min(rest - base, Math.round(rest * 0.35));
    const peak = rest - base - build;
    return [
      ...Array(base).fill('bas'),
      ...Array(build).fill('uppbyggnad'),
      ...Array(peak).fill('topp'),
      ...Array(taper).fill('nedtrappning'),
    ];
  }

  function loadFactor(ctx) {
    if (ctx.phase === 'nedtrappning') return ctx.isLast ? 0.5 : 0.7;
    const f = 1 + 0.35 * ctx.progress;
    return ctx.recovery ? f * 0.7 : f;
  }

  // Tävlingsveckan: några korta pass före och tävlingen på tävlingsdagen.
  function raceWeek(ctx, makeSession) {
    const days = DAY_PATTERNS[ctx.n];
    const raceDay = ctx.raceDay ?? days[days.length - 1];
    const before = days.filter((d) => d < raceDay - 1).slice(-3);
    const sessions = before.map((d, i) => makeSession(i === before.length - 2 ? 'skarpt' : 'lugnt', d));
    sessions.push(makeSession('tavling', raceDay));
    return sessions;
  }

  function raceSession(day, ctx) {
    const name = ctx.goal || ctx.distance || 'din tävling';
    return session(day, 'tavling', `Tävling: ${name}`, null, 'Tävling',
      'Lugn uppvärmning, starta kontrollerat och njut av dagen. Lycka till!');
  }

  // ---- Uthållighet (löpning, cykling, skidor, simning) ----
  const ENDURANCE_TYPES = {
    bas: ['lugnt', 'fartlek', 'lugnt', 'styrka', 'lugnt'],
    uppbyggnad: ['intervaller', 'lugnt', 'tempo', 'styrka', 'lugnt'],
    topp: ['tavlingsfart', 'lugnt', 'intervaller', 'lugnt', 'styrka'],
    nedtrappning: ['skarpt', 'lugnt', 'lugnt', 'lugnt', 'lugnt'],
  };

  function enduranceWeek(ctx) {
    const make = (type, day) => enduranceSession(type, day, ctx);
    if (ctx.isLast && ctx.isRace) return raceWeek(ctx, make);
    let types = ENDURANCE_TYPES[ctx.phase].slice(0, ctx.n - 1);
    if (ctx.recovery) types = types.map((t) => (t === 'styrka' ? t : 'lugnt'));
    types.push(ctx.isLast ? 'test' : 'langpass');
    return types.map((t, i) => make(t, DAY_PATTERNS[ctx.n][i]));
  }

  function enduranceSession(type, day, ctx) {
    const base = BASE_MINUTES[ctx.level] * loadFactor(ctx);
    const step = LEVEL_STEP[ctx.level];
    const act = ACTIVITY[ctx.sport];
    switch (type) {
      case 'lugnt':
        return session(day, type, 'Lugnt pass', round5(base), 'Låg',
          `${act} i lugnt tempo. Du ska kunna prata obehindrat hela passet.`);
      case 'langpass': {
        const cap = ctx.sport === 'lopning' ? LONG_CAP[ctx.distance] ?? 150 : 240;
        return session(day, type, 'Långpass', Math.min(cap, round5(base * (1.5 + 0.6 * ctx.progress))), 'Låg',
          `${act} i jämnt, lugnt tempo. Bygger uthållighet – håll igen i början.`);
      }
      case 'fartlek':
        return session(day, type, 'Fartlek', round5(base), 'Medel',
          `Värm upp 10 min. Sedan ${6 + step * 2} × 1 min lite snabbare följt av 2 min lugnt. Varva ner resten av passet.`);
      case 'intervaller': {
        const reps = 4 + step + Math.round(ctx.progress * 2);
        const work = ctx.phase === 'topp' ? 3 : 4;
        return session(day, type, 'Intervaller', round5(25 + reps * (work + 2)), 'Hög',
          `Värm upp 15 min. ${reps} × ${work} min hårt (tungt men kontrollerat) med 2 min lugn vila. Varva ner 10 min.`);
      }
      case 'tempo': {
        const t = round5(15 + 5 * step + 10 * ctx.progress);
        return session(day, type, 'Tempopass', t + 20, 'Medel–hög',
          `Värm upp 10 min. ${t} min i jobbigt men uthålligt tempo. Varva ner 10 min.`);
      }
      case 'tavlingsfart': {
        const reps = 3 + step;
        return session(day, type, 'Tävlingsfart', round5(25 + reps * 8), 'Hög',
          `Värm upp 15 min. ${reps} × 6 min i planerad tävlingsfart med 2 min lugnt emellan. Varva ner 10 min.`);
      }
      case 'skarpt':
        return session(day, type, 'Kort & skarpt', 35, 'Medel',
          'Värm upp 15 min. 5 × 1 min i tävlingsfart med 2 min lugnt emellan. Varva ner. Håll benen pigga.');
      case 'styrka':
        return session(day, type, 'Styrka & core', 30, 'Medel',
          'Knäböj, utfallssteg, höftlyft, vadpress, planka och sidoplanka. 3 varv, 10–12 reps eller 30–45 s per övning.');
      case 'test':
        return session(day, type, 'Testpass', 45, 'Hög',
          `Värm upp 15 min. ${TESTS[ctx.sport]} Jämför med hur det kändes när du började!`);
      case 'tavling':
        return raceSession(day, ctx);
    }
  }

  // ---- Styrketräning ----
  const WORKOUTS = {
    fullA: { title: 'Helkropp A', exercises: ['Knäböj', 'Bänkpress', 'Hantelrodd', 'Rumänsk marklyft', 'Planka'] },
    fullB: { title: 'Helkropp B', exercises: ['Marklyft', 'Axelpress', 'Chins eller latsdrag', 'Utfallssteg', 'Hängande benlyft'] },
    upperA: { title: 'Överkropp A', exercises: ['Bänkpress', 'Skivstångsrodd', 'Axelpress', 'Chins eller latsdrag', 'Bicepscurl', 'Triceps pushdown'] },
    upperB: { title: 'Överkropp B', exercises: ['Lutande hantelpress', 'Sittande rodd', 'Hantelpress stående', 'Dips', 'Sidolyft', 'Face pulls'] },
    lowerA: { title: 'Underkropp A', exercises: ['Knäböj', 'Rumänsk marklyft', 'Benpress', 'Vadpress', 'Planka'] },
    lowerB: { title: 'Underkropp B', exercises: ['Marklyft', 'Bulgarisk split squat', 'Höftlyft', 'Lårcurl', 'Pallof press'] },
  };
  // De två första övningarna i varje pass följer fasens set × reps, resten är assistansövningar.
  const MAIN_LIFTS = 2;
  const SCHEMES = {
    styrka: { bas: [3, '8'], uppbyggnad: [4, '5'], topp: [5, '3'], nedtrappning: [3, '2–3'] },
    muskler: { bas: [3, '12'], uppbyggnad: [4, '10'], topp: [4, '8'], nedtrappning: [3, '10'] },
  };

  function strengthWeek(ctx) {
    const make = (type, day) => strengthSession(type, day, ctx);
    if (ctx.isLast && ctx.isRace) return raceWeek(ctx, make);
    const plan = ctx.n <= 3
      ? ['fullA', 'fullB', 'fullA'].slice(0, ctx.n)
      : ['upperA', 'lowerA', 'upperB', 'lowerB', 'kondition', 'fullA'].slice(0, ctx.n);
    if (ctx.isLast) plan[plan.length - 1] = 'test';
    return plan.map((t, i) => make(t, DAY_PATTERNS[ctx.n][i]));
  }

  function strengthSession(type, day, ctx) {
    const goal = ['styrka', 'tavling'].includes(ctx.purpose) ? 'styrka' : 'muskler';
    if (WORKOUTS[type]) {
      const [phaseSets, reps] = SCHEMES[goal][ctx.phase];
      const sets = ctx.recovery ? 2 : phaseSets;
      const exercises = WORKOUTS[type].exercises.map((name, i) => ({
        name,
        sets: i < MAIN_LIFTS ? `${sets} × ${reps}` : `${ctx.recovery ? 2 : 3} × 10–12`,
      }));
      const notes = [];
      if (ctx.recovery) notes.push('Återhämtningsvecka: kör ca 60 % av dina vanliga vikter.');
      else if (goal === 'styrka') notes.push('Huvudövningarna tungt med 2–3 min vila. Öka vikten när alla reps går bra.');
      else notes.push('Kör nära utmattning (1–2 reps kvar) med 60–90 s vila.');
      if (ctx.level === 'nyborjare') notes.push('Fokusera på tekniken – börja lätt och öka lite varje vecka.');
      const intensity = ctx.recovery ? 'Låg' : ctx.phase === 'topp' ? 'Hög' : 'Medel';
      const minutes = { nyborjare: 45, van: 60, avancerad: 75 }[ctx.level];
      return session(day, type, WORKOUTS[type].title, minutes, intensity, notes.join(' '), { exercises });
    }
    switch (type) {
      case 'kondition':
        return session(day, type, 'Kondition & rörlighet', 30, 'Låg',
          '20 min lugn kondition (cykel, promenad eller jogg) följt av 10 min rörlighet för höfter, axlar och bröstrygg.');
      case 'lugnt':
        return session(day, type, 'Lätt teknikpass', 40, 'Låg',
          'Baslyften med lätta vikter (ca 50–60 %), 3 × 3. Fokus på teknik och känsla.');
      case 'skarpt':
        return session(day, type, 'Aktivering', 45, 'Medel',
          'Arbeta upp till en tung singel (ca 85–90 %) i varje tävlingslyft. Inga maxförsök.');
      case 'test':
        return goal === 'styrka'
          ? session(day, type, 'Maxtest', 60, 'Hög',
            'Värm upp ordentligt och testa 1RM eller 3RM i knäböj, bänkpress och marklyft. Jämför med när du började!')
          : session(day, type, 'Utvärdering', 60, 'Medel',
            'Kör max antal armhävningar och chins, ta mått och bilder. Jämför med när du började!');
      case 'tavling':
        return raceSession(day, ctx);
    }
  }

  // ---- Blandat (styrka + kondition) ----
  const INTERVALS = {
    bas: '8 × 1 min hårt / 1 min lugnt',
    uppbyggnad: '6 × 2 min hårt / 1 min lugnt',
    topp: '4 × 4 min hårt / 2 min lugnt',
    nedtrappning: '6 × 1 min hårt / 1 min lugnt',
  };

  function mixedWeek(ctx) {
    const make = (type, day) => mixedSession(type, day, ctx);
    if (ctx.isLast && ctx.isRace) return raceWeek(ctx, make);
    let plan = ['fullA', 'kondition', 'fullB', 'lugnt', 'kondition', 'fullA'].slice(0, ctx.n);
    if (ctx.recovery) plan = plan.map((t) => (t === 'kondition' ? 'lugnt' : t));
    if (ctx.isLast) plan[plan.length - 1] = 'test';
    return plan.map((t, i) => make(t, DAY_PATTERNS[ctx.n][i]));
  }

  function mixedSession(type, day, ctx) {
    if (WORKOUTS[type]) {
      const s = strengthSession(type, day, { ...ctx, purpose: 'muskler' });
      return { ...s, duration: s.duration - 15 };
    }
    switch (type) {
      case 'kondition':
        return session(day, type, 'Konditionsintervaller', 35, 'Hög',
          `Välj löpning, cykel, roddmaskin eller crosstrainer. Värm upp 10 min, sedan ${INTERVALS[ctx.phase]}. Varva ner 5 min.`);
      case 'lugnt':
        return session(day, type, 'Lugn kondition', round5(BASE_MINUTES[ctx.level] * loadFactor(ctx) * 1.3), 'Låg',
          'Promenad, jogg, cykel eller simning i lugnt tempo.');
      case 'skarpt':
        return session(day, type, 'Kort & skarpt', 30, 'Medel',
          'Värm upp 10 min, sedan 5 × 1 min hårt / 2 min lugnt. Varva ner.');
      case 'test':
        return session(day, type, 'Testpass', 40, 'Hög',
          'Gå eller spring 3 km så snabbt du kan, och gör sedan max antal armhävningar. Jämför med när du började!');
      case 'tavling':
        return raceSession(day, ctx);
    }
  }

  function buildTips(input, weeks) {
    const tips = [];
    if (input.purpose === 'tavling') tips.push('De sista veckorna trappas mängden ner så att du är utvilad på tävlingsdagen – lita på planen.');
    if (input.purpose === 'viktnedgang') tips.push('Träningen gör mest nytta ihop med ett måttligt kaloriunderskott och gott om protein.');
    if (input.purpose === 'muskler') tips.push('Ät tillräckligt med protein (ca 1,6–2 g per kg kroppsvikt) och sov ordentligt.');
    if (input.level === 'nyborjare') tips.push('Hellre för lätt än för hårt i början. Kroppen behöver tid att vänja sig.');
    if (weeks >= 6) tips.push('Var fjärde vecka är en återhämtningsvecka med lägre belastning – det är då kroppen bygger upp sig.');
    tips.push('Lyssna på kroppen: byt ett hårt pass mot ett lugnt om du är sliten, och vila om du är sjuk.');
    return tips;
  }

  /**
   * input: { purpose, sport, distance, goal, level, sessionsPerWeek, startDate, weeks | targetDate }
   */
  function generate(input) {
    const n = clamp(Number(input.sessionsPerWeek) || 3, 2, 6);
    const start = mondayOf(parseDate(input.startDate));
    const weeks = input.targetDate
      ? weeksUntil(input.startDate, input.targetDate)
      : clamp(Number(input.weeks) || 8, 1, 52);
    const isRace = input.purpose === 'tavling';
    const raceDay = input.targetDate ? weekday(parseDate(input.targetDate)) : null;
    const distance = input.sport === 'lopning' ? input.distance || '' : '';
    const makeWeek = input.sport === 'styrketraning' ? strengthWeek
      : input.sport === 'blandat' ? mixedWeek
      : enduranceWeek;

    const phases = buildPhases(weeks, isRace);
    const loadWeeks = phases.filter((p) => p !== 'nedtrappning').length;

    const weekList = phases.map((phase, i) => {
      const isLast = i === weeks - 1;
      const ctx = {
        ...input,
        distance,
        n,
        phase,
        isRace,
        raceDay,
        isLast,
        recovery: weeks >= 6 && i % 4 === 3 && phase !== 'nedtrappning' && !isLast,
        progress: loadWeeks > 1 ? Math.min(1, i / (loadWeeks - 1)) : 1,
      };
      const weekStart = addDays(start, i * 7);
      const sessions = makeWeek(ctx)
        .sort((a, b) => a.day - b.day)
        .map((s) => ({ ...s, id: uid(), date: toISO(addDays(weekStart, s.day)), done: false }))
        // Första veckan: hoppa över pass som ligger före startdatumet.
        .filter((s) => s.date >= input.startDate);
      return { number: i + 1, phase, recovery: ctx.recovery, startDate: toISO(weekStart), sessions };
    });

    return {
      id: uid(),
      createdAt: new Date().toISOString(),
      name: input.goal || `${LABELS.purpose[input.purpose]} – ${LABELS.sport[input.sport]}`,
      goal: input.goal || '',
      purpose: input.purpose,
      sport: input.sport,
      distance,
      level: input.level,
      sessionsPerWeek: n,
      weeks,
      startDate: input.startDate,
      endDate: input.targetDate || toISO(addDays(start, weeks * 7 - 1)),
      tips: buildTips(input, weeks),
      weekList,
    };
  }

  return { generate, LABELS, parseDate, toISO, addDays, uid };
})();

if (typeof module !== 'undefined') module.exports = Generator;
