// Genererar träningsprogram utifrån syfte, träningsform, tidsperiod och nivå.
// Regelbaserat: veckorna delas in i faser (bas → uppbyggnad → topp → nedtrappning)
// och varje vecka fylls med pass som passar fasen. Passen fördelas sedan ut på
// veckans träningsdagar – fler pass än dagar ger dubbelpass.
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
      hyrox: 'Hyrox',
      styrketraning: 'Styrketräning',
      hybrid: 'Hybrid (styrka + kondition)',
      // Finns kvar för program som skapades innan de togs bort ur listan.
      langdskidor: 'Längdskidor',
      simning: 'Simning',
      blandat: 'Blandat',
    },
    discipline: {
      lopning: 'Löpning',
      styrka: 'Styrka',
      cykling: 'Cykling',
      hyrox: 'Hyrox-pass',
      kondition: 'Kondition',
    },
    level: { nyborjare: 'Nybörjare', van: 'Van', avancerad: 'Avancerad' },
    phase: { bas: 'Basperiod', uppbyggnad: 'Uppbyggnad', topp: 'Toppform', nedtrappning: 'Nedtrappning' },
  };

  // Vilka veckodagar det tränas på (0 = måndag). Sista dagen får långpasset.
  const DAY_PATTERNS = {
    1: [5],
    2: [1, 5],
    3: [0, 2, 5],
    4: [0, 1, 3, 5],
    5: [0, 1, 3, 4, 6],
    6: [0, 1, 2, 3, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  const MAX_SESSIONS = 12;
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
  const HARD = ['Hög', 'Medel–hög', 'Tävling'];

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

  // Tar de första `length` elementen ur listan och fyller på med `filler` (i tur och ordning) vid behov.
  function fill(list, length, filler) {
    const out = list.slice(0, Math.max(0, length));
    for (let i = 0; out.length < length; i++) out.push(filler[i % filler.length]);
    return out;
  }
  // Varvar listorna: första passet ur varje lista, sedan andra, osv.
  function interleave(lists) {
    const out = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => i < l.length && out.push(l[i]));
    return out;
  }

  const session = (type, title, duration, intensity, description, extra = {}) => ({
    type,
    title,
    duration,
    intensity,
    description,
    ...extra,
  });
  const tagSport = (s, label) => ({ ...s, title: `${s.title} · ${label}` });
  // Totalt antal pass i en hybridvecka.
  const mixTotal = (mix = {}, extras = []) =>
    Object.values(mix).reduce((a, b) => a + (Number(b) || 0), 0) + extras.reduce((a, e) => a + (Number(e.count) || 0), 0);

  // ---- Schemaläggning ----
  // Väljer veckans träningsdagar. Utan fasta dagar används standardmönstret. Med fasta dagar (t.ex. fotboll
  // tisdag och torsdag) väljs den kombination som innehåller dem, liknar standardmönstret mest, har ett
  // helgpass och så få dagar i rad som möjligt.
  function pickTrainingDays(count, fixed = []) {
    if (!fixed.length) return DAY_PATTERNS[count];
    const standard = DAY_PATTERNS[count];
    let best = null;
    let bestScore = -Infinity;
    for (let mask = 0; mask < 128; mask++) {
      const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));
      if (days.length !== count || !fixed.every((d) => days.includes(d))) continue;
      const score = 2 * days.filter((d) => standard.includes(d)).length
        + (days.includes(5) || days.includes(6) ? 3 : 0)
        - days.filter((d) => days.includes(d + 1)).length;
      if (score > bestScore) [best, bestScore] = [days, score];
    }
    return best;
  }

  // Fasta pass ("fixedDay") läggs först på sina dagar. Långpass ("anchor: last") läggs på veckans sista
  // träningsdag utan fast pass, ett andra långpass ("second") på dagen före.
  // Övriga pass fyller dagarna i tur och ordning. När alla dagar har ett pass blir det dubbelpass, och då
  // väljs den dag som passar bäst: inte två hårda pass samma dag, helst inga hårda pass dagen före/efter
  // ett annat hårt pass, och helst inte på långpassdagarna.
  function schedule(sessions, trainingDays) {
    const slots = trainingDays.map((day) => ({ day, items: [], anchored: false, fixed: false }));
    const isHard = (s) => HARD.includes(s.intensity);
    const hasHard = (day) => slots.some((x) => x.day === day && x.items.some(isHard));

    for (const s of sessions.filter((x) => x.fixedDay != null)) {
      const slot = slots.find((x) => x.day === s.fixedDay);
      slot.items.push(s);
      slot.fixed = true;
    }
    const open = slots.filter((x) => !x.fixed);
    const longSlots = open.length ? open : slots;
    for (const s of sessions.filter((x) => x.anchor)) {
      const last = longSlots.length - 1;
      const slot = longSlots[s.anchor === 'last' ? last : Math.max(0, last - 1)];
      slot.items.push(s);
      slot.anchored = true;
    }
    for (const s of sessions.filter((x) => !x.anchor && x.fixedDay == null)) {
      const fewest = Math.min(...slots.map((x) => x.items.length));
      const candidates = slots.filter((x) => x.items.length === fewest);
      const score = (x) =>
        (x.anchored ? 5 : 0) +
        (isHard(s) ? (x.items.some(isHard) ? 10 : 0) + 3 * (hasHard(x.day - 1) + hasHard(x.day + 1)) : 0);
      // Första varvet (tomma dagar) följer mallens ordning; dubbelpassen placeras efter poäng.
      const best = fewest === 0 ? candidates[0] : candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
      best.items.push(s);
    }
    return slots.flatMap((x) => x.items.map((s, i) => ({ ...s, day: x.day, slot: i + 1, slots: x.items.length })));
  }

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
  // `busy` = antal fasta pass per veckodag; dagar som redan har två pass hoppas över.
  function raceWeek(ctx, make, busy = {}) {
    const days = ctx.trainingDays;
    const raceDay = ctx.raceDay ?? days[days.length - 1];
    const before = days.filter((d) => d < raceDay - 1 && (busy[d] || 0) < 2).slice(-3);
    return [
      ...before.map((d, i) => ({ ...make(i === before.length - 2 ? 'skarpt' : 'lugnt'), day: d })),
      { ...make('tavling'), day: raceDay },
    ];
  }

  function raceSession(ctx) {
    const name = ctx.goal || ctx.distance || 'din tävling';
    return session('tavling', `Tävling: ${name}`, null, 'Tävling',
      'Lugn uppvärmning, starta kontrollerat och njut av dagen. Lycka till!');
  }

  // ---- Uthållighet (löpning, cykling) ----
  const ENDURANCE_TYPES = {
    bas: ['lugnt', 'fartlek', 'lugnt', 'styrka', 'lugnt'],
    uppbyggnad: ['intervaller', 'lugnt', 'tempo', 'styrka', 'lugnt'],
    topp: ['tavlingsfart', 'lugnt', 'intervaller', 'lugnt', 'styrka'],
    nedtrappning: ['skarpt', 'lugnt', 'lugnt', 'lugnt', 'lugnt'],
  };
  const ENDURANCE_FILL = ['lugnt', 'lugnt', 'styrka', 'lugnt'];

  function enduranceWeek(ctx) {
    const make = (type) => enduranceSession(type, ctx);
    if (ctx.isLast && ctx.isRace) return raceWeek(ctx, make);
    let types = fill(ENDURANCE_TYPES[ctx.phase], ctx.n - 1, ENDURANCE_FILL);
    if (ctx.recovery) types = types.map((t) => (t === 'styrka' ? t : 'lugnt'));
    return [...types.map(make), { ...make(ctx.isLast ? 'test' : 'langpass'), anchor: 'last' }];
  }

  function enduranceSession(type, ctx) {
    const base = BASE_MINUTES[ctx.level] * loadFactor(ctx);
    const step = LEVEL_STEP[ctx.level];
    const act = ACTIVITY[ctx.sport];
    switch (type) {
      case 'lugnt':
        return session(type, 'Lugnt pass', round5(base), 'Låg',
          `${act} i lugnt tempo. Du ska kunna prata obehindrat hela passet.`);
      case 'langpass': {
        const cap = ctx.longCap ?? (ctx.sport === 'lopning' ? LONG_CAP[ctx.distance] ?? 150 : 240);
        return session(type, 'Långpass', Math.min(cap, round5(base * (1.5 + 0.6 * ctx.progress))), 'Låg',
          `${act} i jämnt, lugnt tempo. Bygger uthållighet – håll igen i början.`);
      }
      case 'fartlek':
        return session(type, 'Fartlek', round5(base), 'Medel',
          `Värm upp 10 min. Sedan ${6 + step * 2} × 1 min lite snabbare följt av 2 min lugnt. Varva ner resten av passet.`);
      case 'intervaller': {
        const reps = 4 + step + Math.round(ctx.progress * 2);
        const work = ctx.phase === 'topp' ? 3 : 4;
        return session(type, 'Intervaller', round5(25 + reps * (work + 2)), 'Hög',
          `Värm upp 15 min. ${reps} × ${work} min hårt (tungt men kontrollerat) med 2 min lugn vila. Varva ner 10 min.`);
      }
      case 'tempo': {
        const t = round5(15 + 5 * step + 10 * ctx.progress);
        return session(type, 'Tempopass', t + 20, 'Medel–hög',
          `Värm upp 10 min. ${t} min i jobbigt men uthålligt tempo. Varva ner 10 min.`);
      }
      case 'tavlingsfart': {
        const reps = 3 + step;
        return session(type, 'Tävlingsfart', round5(25 + reps * 8), 'Hög',
          `Värm upp 15 min. ${reps} × 6 min i planerad tävlingsfart med 2 min lugnt emellan. Varva ner 10 min.`);
      }
      case 'skarpt':
        return session(type, 'Kort & skarpt', 35, 'Medel',
          'Värm upp 15 min. 5 × 1 min i tävlingsfart med 2 min lugnt emellan. Varva ner. Håll benen pigga.');
      case 'styrka':
        return session(type, 'Styrka & core', 30, 'Medel',
          'Knäböj, utfallssteg, höftlyft, vadpress, planka och sidoplanka. 3 varv, 10–12 reps eller 30–45 s per övning.');
      case 'test':
        return session(type, 'Testpass', 45, 'Hög',
          `Värm upp 15 min. ${TESTS[ctx.sport]} Jämför med hur det kändes när du började!`);
      case 'tavling':
        return raceSession(ctx);
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

  // Helkropp vid få pass, annars över-/underkropp. Rena styrkeprogram fylls på med kondition och rörlighet.
  function strengthPlan(n, withConditioning) {
    if (n <= 3) return ['fullA', 'fullB', 'fullA'].slice(0, n);
    const filler = withConditioning ? ['kondition', 'fullA', 'rorlighet', 'fullB'] : ['fullA', 'fullB'];
    return fill(['upperA', 'lowerA', 'upperB', 'lowerB'], n, filler);
  }

  function strengthWeek(ctx) {
    const make = (type) => strengthSession(type, ctx);
    if (ctx.isLast && ctx.isRace) return raceWeek(ctx, make);
    const plan = strengthPlan(ctx.n, true);
    if (ctx.isLast) plan[plan.length - 1] = 'test';
    return plan.map(make);
  }

  function strengthSession(type, ctx) {
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
      return session(type, WORKOUTS[type].title, minutes, intensity, notes.join(' '), { exercises });
    }
    switch (type) {
      case 'kondition':
        return session(type, 'Kondition & rörlighet', 30, 'Låg',
          '20 min lugn kondition (cykel, promenad eller jogg) följt av 10 min rörlighet för höfter, axlar och bröstrygg.');
      case 'rorlighet':
        return rorlighetSession();
      case 'lugnt':
        return session(type, 'Lätt teknikpass', 40, 'Låg',
          'Baslyften med lätta vikter (ca 50–60 %), 3 × 3. Fokus på teknik och känsla.');
      case 'skarpt':
        return session(type, 'Aktivering', 45, 'Medel',
          'Arbeta upp till en tung singel (ca 85–90 %) i varje tävlingslyft. Inga maxförsök.');
      case 'test':
        return goal === 'styrka'
          ? session(type, 'Maxtest', 60, 'Hög',
            'Värm upp ordentligt och testa 1RM eller 3RM i knäböj, bänkpress och marklyft. Jämför med när du började!')
          : session(type, 'Utvärdering', 60, 'Medel',
            'Kör max antal armhävningar och chins, ta mått och bilder. Jämför med när du började!');
      case 'tavling':
        return raceSession(ctx);
    }
  }

  const rorlighetSession = () =>
    session('rorlighet', 'Rörlighet & återhämtning', 30, 'Låg',
      '20 min lugn cykel eller promenad följt av rörlighet för höfter, vader, axlar och bröstrygg.');

  // ---- Hyrox ----
  // Tävlingen: 8 × (1 km löpning + en station). Träningsdosen är ungefär halva tävlingsdistansen.
  const STATIONS = [
    { name: 'SkiErg', race: '1000 m', train: '500 m' },
    { name: 'sled push', race: '50 m', train: '25 m' },
    { name: 'sled pull', race: '50 m', train: '25 m' },
    { name: 'burpee broad jumps', race: '80 m', train: '40 m' },
    { name: 'rodd', race: '1000 m', train: '500 m' },
    { name: 'farmers carry', race: '200 m', train: '100 m' },
    { name: 'sandbag lunges', race: '100 m', train: '50 m' },
    { name: 'wall balls', race: '100 st', train: '50 st' },
  ];
  const HYROX_TYPES = {
    bas: ['lugnt', 'hyroxstyrka', 'engine', 'compromised', 'lugnt', 'teknik'],
    uppbyggnad: ['compromised', 'lugnt', 'hyroxstyrka', 'intervaller', 'engine', 'lugnt'],
    topp: ['compromised', 'lugnt', 'hyroxstyrka', 'intervaller', 'engine', 'lugnt'],
    nedtrappning: ['compromised', 'lugnt', 'teknik', 'lugnt', 'engine', 'lugnt'],
  };
  const HYROX_FILL = ['lugnt', 'teknik', 'rorlighet', 'lugnt'];
  // I hybridprogram: bara Hyrox-specifika pass – löpningen väljs för sig.
  const HYROX_ONLY = {
    bas: ['hyroxstyrka', 'engine', 'compromised', 'teknik'],
    uppbyggnad: ['compromised', 'hyroxstyrka', 'engine', 'teknik'],
    topp: ['compromised', 'hyroxstyrka', 'simulering', 'engine'],
    nedtrappning: ['compromised', 'teknik'],
  };
  const ENGINE = {
    bas: '3 × 8 min i jämnt, medelhårt tempo – växla SkiErg och rodd, 2 min vila',
    uppbyggnad: '6 × 500 m hårt, varannan SkiErg och rodd, 1:30 vila',
    topp: '8 × 250 m mycket hårt, varannan SkiErg och rodd, 1 min vila',
    nedtrappning: '4 × 250 m i tävlingsfart, 2 min vila',
  };

  function hyroxWeek(ctx) {
    const make = (type) => hyroxSession(type, ctx);
    if (ctx.isLast && ctx.isRace) return raceWeek(ctx, make);
    let types = fill(HYROX_TYPES[ctx.phase], ctx.n - 1, HYROX_FILL);
    if (ctx.recovery) types = types.map((t) => (['compromised', 'intervaller'].includes(t) ? 'lugnt' : t));
    const key = ctx.isLast ? 'test' : ctx.phase === 'topp' && ctx.index % 2 === 0 ? 'simulering' : 'langpass';
    return [...types.map(make), { ...make(key), anchor: 'last' }];
  }

  function hyroxSession(type, ctx) {
    const step = LEVEL_STEP[ctx.level];
    const run = { ...ctx, sport: 'lopning', distance: '', longCap: 100 };
    // Stationerna roteras från vecka till vecka.
    const stations = (count) => Array.from({ length: count }, (_, i) => STATIONS[(ctx.index * 3 + i) % STATIONS.length]);
    const dose = (s) => (ctx.phase === 'topp' && ctx.level === 'avancerad' ? s.race : s.train);
    switch (type) {
      case 'lugnt':
      case 'langpass':
      case 'intervaller':
      case 'skarpt':
        return tagSport(enduranceSession(type, run), 'löpning');
      case 'compromised': {
        const rounds = clamp(3 + step + Math.round(ctx.progress * 2) - (ctx.phase === 'nedtrappning' ? 2 : 0), 2, 8);
        const list = stations(rounds).map((s) => `${s.name} ${dose(s)}`).join(', ');
        return session(type, 'Compromised running', round5(15 + rounds * 9), 'Hög',
          `Värm upp 10 min. ${rounds} varv: 1 km löpning i tänkt tävlingsfart, direkt följt av en station – ${list}. Vila 1–2 min mellan varven. Träna på att hitta löprytmen med trötta ben.`);
      }
      case 'hyroxstyrka': {
        const [phaseSets, reps] = SCHEMES.styrka[ctx.phase];
        const sets = ctx.recovery ? 2 : phaseSets;
        const sled = ctx.recovery ? 3 : 5;
        const exercises = [
          { name: 'Knäböj eller frontböj', sets: `${sets} × ${reps}` },
          { name: 'Sled push (tungt)', sets: `${sled} × 20 m` },
          { name: 'Sled pull (tungt)', sets: `${sled} × 20 m` },
          { name: 'Utfallssteg med sandsäck', sets: '3 × 20 steg' },
          { name: 'Farmers carry', sets: '4 × 40 m' },
          { name: 'Wall balls', sets: `3 × ${15 + step * 5}` },
        ];
        return session(type, 'Hyrox-styrka', { nyborjare: 50, van: 60, avancerad: 70 }[ctx.level],
          ctx.recovery ? 'Låg' : 'Medel–hög',
          ctx.recovery
            ? 'Återhämtningsvecka: kör ca 60 % av dina vanliga vikter.'
            : 'Tunga slädar och benstyrka – grunden för att orka stationerna. 2–3 min vila på knäböjen.',
          { exercises });
      }
      case 'engine':
        return session(type, 'Motorpass: SkiErg & rodd', 40, ctx.recovery ? 'Medel' : 'Hög',
          `Värm upp 10 min. ${ENGINE[ctx.phase]}. Varva ner 5 min.`);
      case 'teknik':
        return session(type, 'Stationsteknik', 40, 'Medel',
          'Lugnt tempo med fokus på rytm och effektiv teknik: wall balls 5 × 15, burpee broad jumps 4 × 8, sandbag lunges 3 × 20 steg. Öva även övergångarna mellan stationerna.');
      case 'rorlighet':
        return rorlighetSession();
      case 'simulering': {
        const firstHalf = ctx.index % 4 < 2;
        const half = firstHalf ? STATIONS.slice(0, 4) : STATIONS.slice(4);
        return session(type, 'Halv Hyrox-simulering', 50, 'Hög',
          `Värm upp 15 min. 4 × (1 km löpning + station) i tävlingsfart: ${half.map((s) => `${s.name} ${s.race}`).join(', ')}. Notera tiden.`);
      }
      case 'test':
        return session(type, 'Testpass: Hyrox-simulering', 90, 'Hög',
          'Kör hela formatet: 8 × (1 km löpning + station) i ordningen SkiErg, sled push, sled pull, burpee broad jumps, rodd, farmers carry, sandbag lunges och wall balls. Notera tiden – jämför med när du började!');
      case 'tavling':
        return raceSession(ctx);
    }
  }

  // ---- Kondition (valfri maskin) ----
  const INTERVALS = {
    bas: '8 × 1 min hårt / 1 min lugnt',
    uppbyggnad: '6 × 2 min hårt / 1 min lugnt',
    topp: '4 × 4 min hårt / 2 min lugnt',
    nedtrappning: '6 × 1 min hårt / 1 min lugnt',
  };

  function konditionSession(type, ctx) {
    switch (type) {
      case 'kondition':
        return session(type, 'Konditionsintervaller', 35, 'Hög',
          `Välj löpning, cykel, roddmaskin eller crosstrainer. Värm upp 10 min, sedan ${INTERVALS[ctx.phase]}. Varva ner 5 min.`);
      case 'lugnt':
        return session(type, 'Lugn kondition', round5(BASE_MINUTES[ctx.level] * loadFactor(ctx) * 1.3), 'Låg',
          'Promenad, jogg, cykel eller simning i lugnt tempo.');
      case 'skarpt':
        return session(type, 'Kort & skarpt', 30, 'Medel',
          'Värm upp 10 min, sedan 5 × 1 min hårt / 2 min lugnt. Varva ner.');
      case 'test':
        return session(type, 'Testpass', 40, 'Hög',
          'Gå eller spring 3 km så snabbt du kan, och gör sedan max antal armhävningar. Jämför med när du började!');
      case 'tavling':
        return raceSession(ctx);
    }
  }

  // ---- Hybrid: användaren väljer antal pass per sort ----
  const MIX_ORDER = ['lopning', 'hyrox', 'cykling', 'styrka', 'kondition'];

  // Huvudsporten är den med flest pass. Den får långpasset på sista dagen, testet och tävlingen.
  function primaryDiscipline(mix = {}) {
    return MIX_ORDER.reduce((best, k) => ((mix[k] || 0) > (mix[best] || 0) ? k : best), MIX_ORDER[0]);
  }

  function disciplineSession(key, type, ctx) {
    if (key === 'lopning' || key === 'cykling') {
      const s = enduranceSession(type, { ...ctx, sport: key });
      return type === 'tavling' ? s : tagSport(s, key === 'lopning' ? 'löpning' : 'cykling');
    }
    if (key === 'styrka') return strengthSession(type, ctx);
    if (key === 'hyrox') return hyroxSession(type, ctx);
    return konditionSession(type, ctx);
  }

  function disciplineWeek(key, count, ctx, isPrimary) {
    if (!count) return [];
    const make = (type) => disciplineSession(key, type, ctx);
    const last = isPrimary && ctx.isLast;
    let types;
    if (key === 'lopning' || key === 'cykling') {
      types = fill(ENDURANCE_TYPES[ctx.phase].filter((t) => t !== 'styrka'), count - 1, ['lugnt']);
      if (ctx.recovery) types = types.map(() => 'lugnt');
      const long = { ...make(last ? 'test' : 'langpass'), anchor: isPrimary ? 'last' : 'second' };
      return [...types.map(make), long];
    }
    if (key === 'styrka') types = strengthPlan(count, false);
    if (key === 'hyrox') {
      types = fill(HYROX_ONLY[ctx.phase], count, ['teknik', 'engine']);
      if (ctx.recovery) types = types.map((t) => (['compromised', 'simulering'].includes(t) ? 'teknik' : t));
    }
    if (key === 'kondition') {
      types = fill([], count, ['kondition', 'lugnt']);
      if (ctx.recovery) types = types.map(() => 'lugnt');
    }
    if (last) types[types.length - 1] = 'test';
    return types.map(make);
  }

  const extraSession = (name, fixedDay) =>
    session('extra', name, null, 'Medel',
      'Din egen träning. Den räknas in i veckans belastning och programmet planerar de andra passen runt den.',
      fixedDay == null ? {} : { fixedDay });

  function hybridWeek(ctx) {
    const primary = primaryDiscipline(ctx.mix);
    if (ctx.isLast && ctx.isRace) {
      // Fasta pass (t.ex. fotbollsträning) finns kvar tävlingsveckan, utom på själva tävlingsdagen.
      const busy = {};
      ctx.extras.forEach((e) => e.days.forEach((d) => (busy[d] = (busy[d] || 0) + 1)));
      const race = raceWeek(ctx, (type) => disciplineSession(primary, type, ctx), busy);
      const raceDay = race[race.length - 1].day;
      const fixed = ctx.extras.flatMap((e) => e.days.filter((d) => d !== raceDay).map((d) => ({ ...extraSession(e.name), day: d })));
      return [...race, ...fixed];
    }
    const lists = MIX_ORDER.map((key) => disciplineWeek(key, ctx.mix[key] || 0, ctx, key === primary));
    const extras = ctx.extras.flatMap((e) => (e.days.length
      ? e.days.map((d) => extraSession(e.name, d))
      : Array.from({ length: e.count }, () => extraSession(e.name))));
    return interleave([...lists, extras]);
  }

  function buildTips(input, weeks, n, days) {
    const tips = [];
    if (input.purpose === 'tavling') tips.push('De sista veckorna trappas mängden ner så att du är utvilad på tävlingsdagen – lita på planen.');
    if (input.purpose === 'viktnedgang') tips.push('Träningen gör mest nytta ihop med ett måttligt kaloriunderskott och gott om protein.');
    if (input.purpose === 'muskler') tips.push('Ät tillräckligt med protein (ca 1,6–2 g per kg kroppsvikt) och sov ordentligt.');
    if (input.sport === 'hyrox') tips.push('I Hyrox avgörs mycket av löpningen mellan stationerna – träna på att springa med trötta ben.');
    if (input.sport === 'hybrid') tips.push('Passen från alla sporter räknas in i veckans belastning. Lägg gärna de hårdaste passen med minst en dag emellan.');
    if (n > days) tips.push('På dagar med två pass: lägg minst 6 timmar emellan om du kan, och kör det tuffaste passet först.');
    if (input.level === 'nyborjare') tips.push('Hellre för lätt än för hårt i början. Kroppen behöver tid att vänja sig.');
    if (weeks >= 6) tips.push('Var fjärde vecka är en återhämtningsvecka med lägre belastning – det är då kroppen bygger upp sig.');
    tips.push('Lyssna på kroppen: byt ett hårt pass mot ett lugnt om du är sliten, och vila om du är sjuk.');
    return tips;
  }

  // Tillåtna träningsdagar för ett visst antal pass (högst två pass per dag).
  // Fasta dagar måste alltid få plats.
  function dayRange(n, fixedCount = 0) {
    const min = Math.max(1, Math.ceil(n / 2), fixedCount);
    const max = Math.max(min, Math.min(7, n));
    return { min, max, default: clamp(Math.min(n, 6), min, max) };
  }

  // Sätter "Pass 1/2" utifrån hur många pass som ligger på samma dag.
  function numberSlots(sessions) {
    const seen = {};
    const total = {};
    sessions.forEach((s) => (total[s.day] = (total[s.day] || 0) + 1));
    return sessions.map((s) => ({ ...s, slot: (seen[s.day] = (seen[s.day] || 0) + 1), slots: total[s.day] }));
  }

  /**
   * input: { purpose, sport, distance, goal, level, startDate, weeks | targetDate, sessionsPerWeek, days,
   *          mix?: { lopning, styrka, ... }, extras?: [{ name, count, days?: [0–6] }] }
   * extras med days ligger alltid på de veckodagarna (0 = måndag); antalet pass blir då antalet dagar.
   */
  function generate(input) {
    const isHybrid = input.sport === 'hybrid';
    const mix = isHybrid ? Object.fromEntries(MIX_ORDER.map((k) => [k, clamp(Number(input.mix?.[k]) || 0, 0, MAX_SESSIONS)])) : null;
    const extras = isHybrid
      ? (input.extras || [])
        .map((e) => {
          const days = [...new Set((e.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
          return { name: String(e.name).trim(), count: days.length || clamp(Number(e.count) || 0, 0, 7), days };
        })
        .filter((e) => e.name && e.count)
      : [];
    const fixedDays = [...new Set(extras.flatMap((e) => e.days))].sort((a, b) => a - b);
    const n = isHybrid
      ? clamp(mixTotal(mix, extras), 1, MAX_SESSIONS)
      : clamp(Number(input.sessionsPerWeek) || 3, 2, MAX_SESSIONS);
    const range = dayRange(n, fixedDays.length);
    const days = clamp(Number(input.days) || range.default, range.min, range.max);
    const trainingDays = pickTrainingDays(days, fixedDays);

    const start = mondayOf(parseDate(input.startDate));
    const weeks = input.targetDate
      ? weeksUntil(input.startDate, input.targetDate)
      : clamp(Number(input.weeks) || 8, 1, 52);
    const isRace = input.purpose === 'tavling';
    const raceDay = input.targetDate ? weekday(parseDate(input.targetDate)) : null;
    const runsInProgram = input.sport === 'lopning' || (isHybrid && mix.lopning > 0);
    const distance = runsInProgram ? input.distance || '' : '';
    const makeWeek = {
      styrketraning: strengthWeek,
      hyrox: hyroxWeek,
      hybrid: hybridWeek,
    }[input.sport] || enduranceWeek;

    const phases = buildPhases(weeks, isRace);
    const loadWeeks = phases.filter((p) => p !== 'nedtrappning').length;

    const weekList = phases.map((phase, i) => {
      const isLast = i === weeks - 1;
      const ctx = {
        ...input,
        distance,
        mix,
        extras,
        n,
        days,
        trainingDays,
        index: i,
        phase,
        isRace,
        raceDay,
        isLast,
        recovery: weeks >= 6 && i % 4 === 3 && phase !== 'nedtrappning' && !isLast,
        progress: loadWeeks > 1 ? Math.min(1, i / (loadWeeks - 1)) : 1,
      };
      const weekStart = addDays(start, i * 7);
      const raw = makeWeek(ctx);
      // Tävlingsveckan har redan dagar satta, övriga veckor schemaläggs.
      const placed = raw.every((s) => s.day != null)
        ? numberSlots([...raw].sort((a, b) => a.day - b.day))
        : schedule(raw, trainingDays);
      const sessions = placed
        .sort((a, b) => a.day - b.day || a.slot - b.slot)
        .map(({ anchor, fixedDay, ...s }) => ({ ...s, id: uid(), date: toISO(addDays(weekStart, s.day)), done: false }))
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
      days,
      mix,
      extras,
      weeks,
      startDate: input.startDate,
      endDate: input.targetDate || toISO(addDays(start, weeks * 7 - 1)),
      tips: buildTips(input, weeks, n, days),
      weekList,
    };
  }

  return { generate, LABELS, MIX_ORDER, MAX_SESSIONS, dayRange, mixTotal, parseDate, toISO, addDays, uid };
})();

if (typeof module !== 'undefined') module.exports = Generator;
