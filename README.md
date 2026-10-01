# Fitsphere

Skapa träningsprogram utifrån mål, tidsperiod och nivå – och för journal över träningen.

## Funktioner

- **Programgenerator** – välj syfte (tävling, kondition, styrka, muskler, viktnedgång, hälsa), träningsform (löpning, cykling, Hyrox, styrketräning eller hybrid), antal veckor eller måldatum, 2–12 pass per vecka, antal träningsdagar och nivå. Programmet delas in i faser (bas → uppbyggnad → topp → nedtrappning) med återhämtningsveckor. Fler pass än träningsdagar ger dubbelpass.
- **Hybrid** – välj själv antal pass per sort (löpning, styrka, cykling, Hyrox, kondition) och lägg till egna sporter, t.ex. padel eller fotboll.
- **Prestationsbaserat** – nuvarande löptider (5/10/21,1 km) och måltid ger tempon i passen (Jack Daniels VDOT); 1RM ger vikter i kg för styrkepassen.
- **Redigera pass** – ändra, flytta, lägg till eller ta bort pass och övningar.
- **AI-chatt** – beskriv en ändring i fritext; AI:n (Claude, via Supabase-funktionen `supabase/functions/plan-chat`) föreslår ändringar som du godkänner. **Avstängd tills vidare** (kostar pengar) – se `KOM-IHAG.md`.
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
