export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const SUMMARY_TEXT_LIMIT = 4000;

function stripMarkdownFences(content, fallback) {
  let raw = content?.trim() ?? fallback;
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return raw;
}

function parseJsonOrFallback(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback(raw);
  }
}

function normalizePersonaTopics(values) {
  if (!Array.isArray(values)) return [];

  return values
    .map((value) => value?.trim())
    .filter(Boolean);
}

function formatPersonaContext(persona, historyItems = []) {
  const blocks = [
    `### ${persona.nome} | id: "${persona.id}"`,
    persona.descricao,
  ];

  const prioridades = normalizePersonaTopics(persona.prioridades);
  if (prioridades.length) {
    blocks.push(`Prioridades:\n- ${prioridades.join('\n- ')}`);
  }

  const evitar = normalizePersonaTopics(persona.evitar);
  if (evitar.length) {
    blocks.push(`Evitar:\n- ${evitar.join('\n- ')}`);
  }

  if (historyItems.length) {
    blocks.push(`Noticias ja enviadas recentemente que nao podem se repetir:\n- ${historyItems.join('\n- ')}`);
  }

  return blocks.join('\n');
}

function resolvePreselectionOptions(options) {
  if (typeof options === 'number') {
    return {
      maxPerPersona: options,
      model: DEFAULT_GROQ_MODEL,
      historyByPersona: {},
    };
  }

  return {
    maxPerPersona: options?.maxPerPersona ?? 15,
    model: options?.model ?? DEFAULT_GROQ_MODEL,
    historyByPersona: options?.historyByPersona ?? {},
  };
}

export async function summarize(groq, title, text, link, model = DEFAULT_GROQ_MODEL) {
  const prompt = `Voce e um editor de noticias. Gere um JSON com:
- "chamada": titulo impactante com no maximo 15 palavras
- "resumo": resumo objetivo com 3 a 5 frases
- "link": URL original do artigo

Responda apenas com JSON, sem markdown.

Titulo: ${title}
URL: ${link}
Texto:
${text.slice(0, SUMMARY_TEXT_LIMIT)}`;

  const completion = await groq.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 320,
  });

  const raw = stripMarkdownFences(completion.choices[0]?.message?.content, '{}');
  return parseJsonOrFallback(raw, (fallbackText) => ({ chamada: title, resumo: fallbackText, link }));
}

export async function preSelectByAllPersonas(groq, articles, personas, options = {}) {
  const { maxPerPersona, model, historyByPersona } = resolvePreselectionOptions(options);
  const articleList = articles
    .map((article, index) => {
      const dateTag = article.dateStr ? article.dateStr.slice(0, 16) : 'sem data';
      return `[${index}] ${article.title} (${dateTag})`;
    })
    .join('\n');

  const personaDescriptions = personas
    .map((persona) => formatPersonaContext(persona, historyByPersona[persona.id] ?? []))
    .join('\n\n');

  const idList = personas.map((persona) => `"${persona.id}"`).join(', ');

  const prompt = `Voce e um curador de noticias especializado. Analise os perfis abaixo e selecione artigos relevantes apenas pelos titulos.

Regras:
- maximo de ${maxPerPersona} artigos por cliente
- um mesmo artigo pode ser selecionado para multiplos clientes
- artigos "sem data" devem ser avaliados normalmente
- prefira artigos mais recentes quando houver empate
- seja criterioso e priorize os temas centrais de cada persona
- descarte assuntos perifericos, promocionais, taticos ou fora de contexto
- respeite rigidamente a lista "Evitar" de cada persona
- nunca repita itens listados como noticias ja enviadas recentemente

Perfis:
${personaDescriptions}

Artigos:
${articleList}

Responda apenas com JSON. As chaves devem ser os IDs exatos: ${idList}

{
  "selecao": {
    "id_cliente": [0, 3, 7]
  }
}`;

  const completion = await groq.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1024,
  });

  const raw = stripMarkdownFences(completion.choices[0]?.message?.content, '{"selecao":{}}');

  try {
    const selecao = JSON.parse(raw).selecao ?? {};
    const result = {};
    for (const persona of personas) {
      result[persona.id] = (selecao[persona.id] ?? [])
        .filter((index) => Number.isInteger(index) && index >= 0 && index < articles.length)
        .slice(0, maxPerPersona);
    }
    return result;
  } catch {
    return Object.fromEntries(personas.map((persona) => [persona.id, []]));
  }
}

export async function filterByPersona(groq, articles, persona, model = DEFAULT_GROQ_MODEL) {
  const articleList = articles
    .filter((article) => !article.error)
    .map((article, index) => `[${index}] ${article.title} - ${article.link}`)
    .join('\n');

  const prompt = `Voce e um curador de noticias. Abaixo esta o perfil de um cliente e uma lista de artigos.
Selecione apenas os artigos diretamente relevantes para este cliente.

Regras:
- priorize os temas centrais e de maior impacto para a pessoa ou negocio
- descarte assuntos perifericos, promocionais, taticos ou fora de contexto
- respeite rigidamente a lista "Evitar", quando existir

Perfil do cliente:
${formatPersonaContext(persona)}

Lista de artigos:
${articleList}

Responda apenas com JSON no formato:
{"selecionados": [0, 3, 5]}

Se nenhum for relevante, retorne {"selecionados": []}.`;

  const completion = await groq.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 256,
  });

  const raw = stripMarkdownFences(completion.choices[0]?.message?.content, '{"selecionados":[]}');
  try {
    return JSON.parse(raw).selecionados ?? [];
  } catch {
    return [];
  }
}
