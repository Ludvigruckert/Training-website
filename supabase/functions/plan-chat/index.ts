// AI-chatt för att ändra träningsprogram. Körs som Supabase Edge Function (Deno).
// Tar emot användarens meddelande + programmet och svarar med en förklaring och föreslagna ändringar.
// Inget sparas här – webbsidan visar förslagen och användaren godkänner dem.
//
// Kräver hemligheten ANTHROPIC_API_KEY (Supabase: Edge Functions → Secrets).
// Supabase kontrollerar inloggningen (JWT) innan funktionen körs, så bara inloggade användare når hit.
import Anthropic from 'npm:@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM = `Du är en erfaren tränare i appen Fitsphere. Användaren har ett träningsprogram och ber dig ändra det.

Regler:
- Ändra bara det användaren ber om. Rör inte övriga pass.
- Behåll passens id när du ändrar eller tar bort pass. Nya pass får id null.
- Datum måste ligga inom programmets veckor (format ÅÅÅÅ-MM-DD).
- Håll stilen från programmet: korta, konkreta beskrivningar på svenska, med tempon och vikter när det är relevant.
- För styrkepass: fyll i exercises med namn, set × reps och belastning (t.ex. "75 % · 90 kg" om 1RM är känt).
- Tänk på helheten: lägg inte två hårda pass i rad om det går att undvika, och tänk på återhämtning.
- Om frågan inte kräver någon ändring (t.ex. en fråga om träning), svara bara och lämna changes tom.
- Om något är oklart, fråga i reply och lämna changes tom.
- reply ska vara kort (1–4 meningar) och förklara vad du ändrat och varför.`;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const SESSION_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'ÅÅÅÅ-MM-DD' },
    title: { type: 'string' },
    duration: nullable({ type: 'integer', description: 'Minuter' }),
    intensity: { type: 'string', enum: ['Låg', 'Medel', 'Medel–hög', 'Hög', 'Tävling'] },
    description: { type: 'string' },
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sets: { type: 'string', description: 't.ex. "4 × 5"' },
          load: { type: 'string', description: 't.ex. "80 % · 95 kg" eller tom sträng' },
        },
        required: ['name', 'sets', 'load'],
        additionalProperties: false,
      },
    },
  },
  required: ['date', 'title', 'duration', 'intensity', 'description', 'exercises'],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['update', 'add', 'delete'] },
          id: nullable({ type: 'string', description: 'Passets id vid update/delete, annars null' }),
          session: nullable(SESSION_SCHEMA),
        },
        required: ['action', 'id', 'session'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'changes'],
  additionalProperties: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Endast POST stöds.' }, 405);

  let body: { message?: string; program?: unknown; history?: { role: 'user' | 'assistant'; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Ogiltig förfrågan.' }, 400);
  }
  const message = String(body.message ?? '').slice(0, 2000).trim();
  if (!message || !body.program) return json({ error: 'Meddelande och program krävs.' }, 400);

  // Tidigare meddelanden i chatten (bara text), max de 10 senaste.
  const history: Anthropic.Beta.BetaMessageParam[] = (body.history ?? [])
    .slice(-10)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // Om modellens säkerhetsfilter avböjer, kör om på Anthropics rekommenderade reservmodell.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        { role: 'user', content: `Mitt träningsprogram (JSON):\n${JSON.stringify(body.program)}` },
        { role: 'assistant', content: 'Jag har läst programmet. Vad vill du ändra?' },
        ...history,
        { role: 'user', content: message },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return json({ reply: 'Jag kan tyvärr inte hjälpa till med det. Försök formulera om önskemålet.', changes: [] });
    }
    if (response.stop_reason === 'max_tokens') {
      return json({ error: 'Svaret blev för långt. Be om en mindre ändring i taget.' }, 502);
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'Tomt svar från AI:n.' }, 502);
    return json(JSON.parse(text.text));
  } catch (error) {
    console.error(error);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'AI:n är upptagen just nu. Försök igen om en stund.' }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'AI-tjänsten är inte rätt inställd (API-nyckel).' }, 500);
    if (error instanceof Anthropic.APIError) return json({ error: `AI-tjänsten svarade med fel ${error.status}.` }, 502);
    return json({ error: 'Något gick fel i AI-chatten.' }, 500);
  }
});
