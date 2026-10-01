# Kom ihåg – att göra i framtiden

## AI-chatt för att ändra programmet (byggd, men avstängd)

Man beskriver en ändring i fritext, t.ex. ”Byt tisdagens intervaller mot ett cykelpass” eller ”Jag kan inte träna på fredagar”. AI:n föreslår ändringar som man godkänner eller avvisar.

Avstängd eftersom den kostar pengar: ungefär 0,5–1,5 kr per meddelande med Claude Opus 5.5. En mindre modell blir billigare.

Koden finns redan:
- `supabase/functions/plan-chat/index.ts` – serverfunktionen som anropar Claude.
- `js/app.js` – chattrutan i programvyn (avsnittet "AI-chatt").

Så slås den på:
1. Skaffa en API-nyckel på [console.anthropic.com](https://console.anthropic.com) och fyll på kredit.
2. Kör i terminalen:
   ```
   supabase login
   supabase secrets set ANTHROPIC_API_KEY=din-nyckel --project-ref jrwuzajjsfabkywodrub
   supabase functions deploy plan-chat --project-ref jrwuzajjsfabkywodrub
   ```
3. Sätt `aiChat: true` i `js/config.js`.

## Övrigt

- Publicera sidan med GitHub Pages så att den får en riktig adress. Sätt sedan Site URL i Supabase och slå på "Confirm email" igen.
