# Träningsplaneraren

Skapa träningsprogram utifrån mål, tidsperiod och nivå – och för journal över träningen.

## Funktioner

- **Programgenerator** – välj syfte (tävling, kondition, styrka, muskler, viktnedgång, hälsa), träningsform, antal veckor eller måldatum, pass per vecka och nivå. Programmet delas in i faser (bas → uppbyggnad → topp → nedtrappning) med återhämtningsveckor.
- **Träningsjournal** – logga pass med tid, distans, känsla och anteckningar. Pass kan loggas direkt från programmet och markeras då som klara.

## Kom igång

Öppna `index.html` i webbläsaren. Inget behöver installeras.

## Struktur

- `index.html` – sidans struktur
- `css/style.css` – utseende
- `js/generator.js` – logiken som skapar träningsprogrammen
- `js/storage.js` – sparar data (just nu i webbläsaren, senare på användarens konto)
- `js/app.js` – kopplar ihop gränssnittet

## Nästa steg

- Inloggning och konton (Supabase) så att allt sparas på kontot
