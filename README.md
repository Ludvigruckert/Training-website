# Träningsplaneraren

Skapa träningsprogram utifrån mål, tidsperiod och nivå – och för journal över träningen.

## Funktioner

- **Programgenerator** – välj syfte (tävling, kondition, styrka, muskler, viktnedgång, hälsa), träningsform, antal veckor eller måldatum, pass per vecka och nivå. Programmet delas in i faser (bas → uppbyggnad → topp → nedtrappning) med återhämtningsveckor.
- **Konton** – logga in med e-post och lösenord (Supabase). Program och journal sparas på kontot.
- **Träningsjournal** – logga pass med tid, distans, känsla och anteckningar. Pass kan loggas direkt från programmet och markeras då som klara.

## Kom igång

Öppna `index.html` i webbläsaren. Inget behöver installeras.

Inloggning och databas sköts av [Supabase](https://supabase.com). Uppgifterna till projektet står i `js/config.js`, och databasschemat finns i `supabase/schema.sql`. Lämnas `js/config.js` tom körs sidan utan inloggning och sparar allt i webbläsaren.

## Struktur

- `index.html` – sidans struktur
- `css/style.css` – utseende
- `js/config.js` – Supabase-inställningar
- `js/generator.js` – logiken som skapar träningsprogrammen
- `js/auth.js` – inloggning, registrering och återställning av lösenord
- `js/storage.js` – sparar data (Supabase eller webbläsaren)
- `js/app.js` – kopplar ihop gränssnittet
- `supabase/schema.sql` – tabeller och behörigheter i databasen

## Nästa steg

- Publicera sidan med GitHub Pages och slå på e-postbekräftelse i Supabase
