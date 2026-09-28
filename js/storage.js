// Datalager. Just nu sparas allt i webbläsaren (localStorage).
// När inloggning läggs till byts bara den här filen ut mot en databas –
// därför är alla funktioner async redan nu.
const DataStore = (() => {
  const KEYS = { programs: 'tp.programs', journal: 'tp.journal' };

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

  return {
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
      return read(KEYS.journal).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
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
})();
