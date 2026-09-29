// Inloggning via Supabase Auth. Utan Supabase (tom config) är inloggning avstängd.
const Auth = (() => {
  const client = DataStore.client;
  let user = null;
  let recovering = false; // användaren har klickat på en länk för nytt lösenord
  let mode = 'login';
  let onChange = () => {};

  const MODES = {
    login: { title: 'Logga in', submit: 'Logga in', password: true, autocomplete: 'current-password' },
    signup: { title: 'Skapa konto', submit: 'Skapa konto', password: true, autocomplete: 'new-password' },
    reset: { title: 'Glömt lösenord', submit: 'Skicka länk', password: false },
    newpassword: { title: 'Välj nytt lösenord', submit: 'Spara lösenord', password: true, email: false, autocomplete: 'new-password' },
  };

  const ERRORS = [
    [/invalid login credentials/i, 'Fel e-post eller lösenord.'],
    [/already registered/i, 'Det finns redan ett konto med den e-postadressen.'],
    [/email not confirmed/i, 'Bekräfta din e-post först – kolla inkorgen.'],
    [/password should be at least/i, 'Lösenordet måste vara minst 6 tecken.'],
    [/rate limit|too many/i, 'För många försök. Vänta en stund och försök igen.'],
    [/failed to fetch|network/i, 'Kunde inte nå servern. Kontrollera din internetanslutning.'],
  ];
  const translate = (error) => ERRORS.find(([re]) => re.test(error.message))?.[1] || error.message;

  const form = document.querySelector('#auth-form');
  const message = document.querySelector('#auth-message');
  const siteUrl = () => location.href.split('#')[0];

  function showMessage(text, type = 'error') {
    message.textContent = text;
    message.className = `message ${type}`;
    message.hidden = !text;
  }

  function setMode(next) {
    mode = next;
    const m = MODES[mode];
    const f = form.elements;
    document.querySelector('#auth-title').textContent = m.title;
    document.querySelector('#auth-submit').textContent = m.submit;
    document.querySelector('#email-field').hidden = m.email === false;
    document.querySelector('#password-field').hidden = !m.password;
    f.email.required = m.email !== false;
    f.password.required = m.password;
    if (m.autocomplete) f.password.autocomplete = m.autocomplete;
    document.querySelectorAll('[data-auth-mode]').forEach((b) => {
      b.hidden = b.dataset.authMode === mode || mode === 'newpassword';
    });
    showMessage('');
  }

  document.querySelector('.auth-links').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auth-mode]');
    if (b) setMode(b.dataset.authMode);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const button = document.querySelector('#auth-submit');
    button.disabled = true;
    showMessage('');
    try {
      if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: siteUrl() } });
        if (error) throw error;
        if (!data.session) {
          setMode('login');
          showMessage(`Klart! Vi har skickat ett mejl till ${email}. Klicka på länken i mejlet och logga sedan in.`, 'success');
        }
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
        if (error) throw error;
        showMessage('Om det finns ett konto med den adressen har vi skickat en länk för att välja nytt lösenord.', 'success');
      } else if (mode === 'newpassword') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        recovering = false;
        form.reset();
        setMode('login');
        onChange();
      }
    } catch (error) {
      showMessage(translate(error));
    } finally {
      button.disabled = false;
    }
  });

  async function init(callback) {
    onChange = callback;
    setMode('login');
    if (!client) return;
    const { data } = await client.auth.getSession();
    user = data.session?.user ?? null;
    client.auth.onAuthStateChange((event, session) => {
      const previous = user?.id;
      user = session?.user ?? null;
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        setMode('newpassword');
      }
      // Rita bara om när användaren faktiskt byts (inte vid t.ex. förnyad token).
      // setTimeout: Supabase rekommenderar att inte anropa databasen direkt i denna callback.
      if (previous !== user?.id || event === 'PASSWORD_RECOVERY') {
        setTimeout(() => onChange(event === 'SIGNED_IN' && !previous), 0);
      }
    });
  }

  return {
    init,
    enabled: !!client,
    get user() {
      return user;
    },
    needsLogin: () => !!client && (!user || recovering),
    async signOut() {
      await client.auth.signOut();
    },
  };
})();
