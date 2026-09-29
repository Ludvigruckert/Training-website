// Datalager. Med Supabase konfigurerat (js/config.js) sparas allt på användarens konto,
// annars i webbläsaren (localStorage). Resten av appen använder bara DataStore.
const DataStore = (() => {
  const KEYS = { programs: 'tp.programs', journal: 'tp.journal' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  const byNewest = (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

  const localStore = {
    async getPrograms() {
      return read(KEYS.programs);
    },
    async getProgram(id) {
      return read(KEYS.programs).find((p) => p.id === id) || null;
    },
    async saveProgram(program) {
      const all = read(KEYS.programs);
      const i = all.findIndex((p) => p.id === program.id);
      if (i >= 0) all[i] = program;
      else all.unshift(program);
      write(KEYS.programs, all);
    },
    async deleteProgram(id) {
      write(KEYS.programs, read(KEYS.programs).filter((p) => p.id !== id));
    },
    async getJournal() {
      return read(KEYS.journal).sort(byNewest);
    },
    async addEntry(entry) {
      write(KEYS.journal, [entry, ...read(KEYS.journal)]);
    },
    async deleteEntry(id) {
      const all = read(KEYS.journal);
      write(KEYS.journal, all.filter((e) => e.id !== id));
      return all.find((e) => e.id === id) || null;
    },
  };

  function supabaseStore(client) {
    const check = ({ data, error }) => {
      if (error) throw error;
      return data;
    };
    return {
      async getPrograms() {
        const rows = check(await client.from('programs').select('data').order('created_at', { ascending: false }));
        return rows.map((r) => r.data);
      },
      async getProgram(id) {
        const row = check(await client.from('programs').select('data').eq('id', id).maybeSingle());
        return row?.data ?? null;
      },
      async saveProgram(program) {
        check(await client.from('programs').upsert({ id: program.id, data: program }));
      },
      async deleteProgram(id) {
        check(await client.from('programs').delete().eq('id', id));
      },
      async getJournal() {
        const rows = check(await client.from('journal_entries').select('data'));
        return rows.map((r) => r.data).sort(byNewest);
      },
      async addEntry(entry) {
        check(await client.from('journal_entries').insert({ id: entry.id, date: entry.date, data: entry }));
      },
      async deleteEntry(id) {
        const row = check(await client.from('journal_entries').delete().eq('id', id).select('data').maybeSingle());
        return row?.data ?? null;
      },

      // Data som sparats i webbläsaren innan inloggning fanns.
      localCounts() {
        return { programs: read(KEYS.programs).length, entries: read(KEYS.journal).length };
      },
      async importLocal() {
        // Äldre id:n är inte alltid UUID – databasen kräver det, så de byts ut vid behov.
        const newIds = {};
        const fixId = (id) => (UUID.test(id) ? id : (newIds[id] ??= Generator.uid()));
        const programs = read(KEYS.programs).map((p) => ({ ...p, id: fixId(p.id) }));
        const entries = read(KEYS.journal).map((e) => ({
          ...e,
          id: fixId(e.id),
          programId: e.programId ? fixId(e.programId) : null,
        }));
        if (programs.length) {
          check(await client.from('programs').upsert(programs.map((p) => ({ id: p.id, data: p }))));
        }
        if (entries.length) {
          check(await client.from('journal_entries').upsert(entries.map((e) => ({ id: e.id, date: e.date, data: e }))));
        }
        localStorage.removeItem(KEYS.programs);
        localStorage.removeItem(KEYS.journal);
      },
    };
  }

  const client = CONFIG.supabaseUrl && window.supabase
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)
    : null;

  return { ...(client ? supabaseStore(client) : localStore), client };
})();
