const SUMMARIZE_MODEL = 'llama-3.3-70b-versatile';

export async function summarize(groq, title, text, link, model = SUMMARIZE_MODEL) {
  const prompt = `Você é um editor de notícias. Com base no artigo abaixo, gere um JSON com:
- "chamada": título impactante de até 15 palavras
- "resumo": resumo objetivo de 3-5 frases para distribuição jornalística
- "link": URL original do artigo

Responda APENAS com o JSON, sem markdown.

Título: ${title}
URL: ${link}
Texto:
${text.slice(0, 6000)}`;

  const completion = await groq.chat.completions.create({
    model,
    messages   : [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens : 512,
  });

  let raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return { ...JSON.parse(raw), link };
  } catch {
    return { chamada: title, resumo: raw, link };
  }
}

/**
 * Single Groq call that evaluates all article titles against all personas at once.
 * Returns { [personaId]: number[] } — up to maxPerPersona article indices per persona.
 * Articles with null dates are included and evaluated by the AI on title merit.
 */
export async function preSelectByAllPersonas(groq, articles, personas, maxPerPersona = 15) {
  const articleList = articles
    .map((a, i) => {
      const dateTag = a.dateStr ? a.dateStr.slice(0, 16) : 'sem data';
      return `[${i}] ${a.title}  (${dateTag})`;
    })
    .join('\n');

  const personaDescriptions = personas
    .map((p) => `### ${p.nome}  |  id: "${p.id}"\n${p.descricao}`)
    .join('\n\n');

  const idList = personas.map((p) => `"${p.id}"`).join(', ');

  const prompt = `Você é um curador de notícias especializado. Analise os perfis dos clientes e a lista de artigos abaixo.

TAREFA: Para cada cliente, selecione os artigos mais relevantes baseando-se APENAS nos títulos.

REGRAS:
- Máximo de ${maxPerPersona} artigos por cliente
- Um mesmo artigo pode ser selecionado para múltiplos clientes
- Artigos marcados "sem data" devem ser avaliados normalmente pelo conteúdo do título
- Prefira artigos mais recentes quando houver empate de relevância
- Seja criterioso: selecione apenas artigos genuinamente relevantes para o perfil

PERFIS DOS CLIENTES:
${personaDescriptions}

LISTA DE ARTIGOS (formato: [índice] título  (data)):
${articleList}

Responda APENAS com JSON. As chaves devem ser os IDs exatos: ${idList}

{
  "selecao": {
    "id_cliente": [0, 3, 7]
  }
}`;

  const completion = await groq.chat.completions.create({
    model      : SUMMARIZE_MODEL,
    messages   : [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens : 1024,
  });

  let raw = completion.choices[0]?.message?.content?.trim() ?? '{"selecao":{}}';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  try {
    const selecao = JSON.parse(raw).selecao ?? {};
    const result  = {};
    for (const persona of personas) {
      result[persona.id] = (selecao[persona.id] ?? [])
        .filter((i) => Number.isInteger(i) && i >= 0 && i < articles.length)
        .slice(0, maxPerPersona);
    }
    return result;
  } catch {
    return Object.fromEntries(personas.map((p) => [p.id, []]));
  }
}

export async function filterByPersona(groq, articles, persona) {
  const articleList = articles
    .filter((a) => !a.error)
    .map((a, i) => `[${i}] ${a.title} — ${a.link}`)
    .join('\n');

  const prompt = `Você é um curador de notícias. Abaixo está o perfil de um cliente e uma lista de artigos.
Selecione APENAS os artigos relevantes para este cliente.

Perfil do cliente:
${persona.descricao}

Lista de artigos (formato: [índice] título — link):
${articleList}

Responda APENAS com um JSON no formato:
{"selecionados": [0, 3, 5]}

Use os índices da lista. Se nenhum for relevante, retorne {"selecionados": []}.`;

  const completion = await groq.chat.completions.create({
    model      : SUMMARIZE_MODEL,
    messages   : [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens : 256,
  });

  let raw = completion.choices[0]?.message?.content?.trim() ?? '{"selecionados":[]}';
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(raw).selecionados ?? [];
  } catch {
    return [];
  }
}
