// Inställningar för Supabase (inloggning och databas).
// Värdena hittas i Supabase under Project Settings → API Keys.
// Nyckeln är publik och får ligga i koden – datan skyddas av Row Level Security (se supabase/schema.sql).
// Lämnas fälten tomma körs sidan utan inloggning och sparar allt i webbläsaren.
const CONFIG = {
  supabaseUrl: 'https://jrwuzajjsfabkywodrub.supabase.co',
  supabaseKey: 'sb_publishable_Vfe8GNpcRnRoFYcdMui-pQ_ynxNSXZP',
};
