import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Groq from 'groq-sdk';

import { createBrowser, scrapeArticles, fetchArticleText } from './lib/scraper.js';
import { summarize, filterByPersona } from './lib/ai.js';
import {
  resolveGoogleAuthConfig,
  buildGoogleClients,
  createGoogleDoc,
  resolveDocSharingConfig,
  validateGoogleAccess,
} from './lib/google.js';
import { formatToolError } from './lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const server = new Server(
  { name: 'mcp-news-automation', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'fetch_portal_news',
      description:
        'Acessa portais de noticias via Puppeteer, filtra artigos dos ultimos N dias e ' +
        'extrai titulo + texto completo de cada um.',
      inputSchema: {
        type      : 'object',
        properties: {
          sites: {
            type       : 'array',
            items      : { type: 'string' },
            description: 'Lista de URLs dos portais. Vazio = usa NEWS_SITES do .env.',
          },
          days_back: {
            type       : 'number',
            description: 'Dias retroativos a considerar (padrao: NEWS_DAYS_BACK do .env ou 3).',
          },
          max_articles_per_site: {
            type       : 'number',
            description: 'Maximo de artigos por portal (padrao: 5).',
          },
        },
      },
    },
    {
      name: 'summarize_news_groq',
      description:
        'Envia o texto de um artigo para a API do Groq e retorna um resumo estruturado ' +
        'com Chamada, Resumo e Link.',
      inputSchema: {
        type      : 'object',
        required  : ['title', 'text', 'link'],
        properties: {
          title: { type: 'string', description: 'Titulo original do artigo.' },
          text : { type: 'string', description: 'Texto completo do artigo.' },
          link : { type: 'string', description: 'URL do artigo.' },
          model: {
            type       : 'string',
            description: 'Modelo Groq (padrao: llama-3.3-70b-versatile).',
          },
        },
      },
    },
    {
      name: 'generate_google_doc',
      description:
        'Cria um Google Doc formatado com os resumos das noticias e retorna o link compartilhavel.',
      inputSchema: {
        type      : 'object',
        required  : ['doc_title', 'news_items'],
        properties: {
          doc_title : { type: 'string', description: 'Titulo do documento Google.' },
          news_items: {
            type       : 'array',
            description: 'Array de noticias resumidas.',
            items      : {
              type      : 'object',
              required  : ['chamada', 'resumo', 'link'],
              properties: {
                chamada: { type: 'string' },
                resumo : { type: 'string' },
                link   : { type: 'string' },
              },
            },
          },
          folder_id: {
            type       : 'string',
            description: 'ID da pasta no Google Drive (opcional, usa GOOGLE_DRIVE_FOLDER_ID do .env).',
          },
        },
      },
    },
    {
      name: 'filter_news_by_persona',
      description:
        'Usa IA para filtrar quais artigos sao relevantes para cada persona em personas.json. ' +
        'Retorna um objeto com os artigos selecionados por persona.',
      inputSchema: {
        type      : 'object',
        required  : ['articles'],
        properties: {
          articles: {
            type       : 'array',
            description: 'Array de artigos retornado por fetch_portal_news.',
            items      : { type: 'object' },
          },
          persona_ids: {
            type       : 'array',
            items      : { type: 'string' },
            description: 'IDs das personas a filtrar (omita para usar todas do personas.json).',
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === 'fetch_portal_news') {
      const daysBack = args.days_back ?? parseInt(process.env.NEWS_DAYS_BACK ?? '3', 10);
      const maxPerSite = args.max_articles_per_site ?? 5;
      const envSites = (process.env.NEWS_SITES ?? '').split(',').map((site) => site.trim()).filter(Boolean);
      const sites = args.sites?.length ? args.sites : envSites;

      if (!sites.length) {
        return {
          content: [{ type: 'text', text: 'Nenhum portal configurado. Defina NEWS_SITES no .env ou passe "sites".' }],
          isError: true,
        };
      }

      const allArticles = [];
      const browser = await createBrowser();

      try {
        for (const siteUrl of sites) {
          try {
            console.error(`[fetch] Acessando: ${siteUrl}`);
            const { articles, meta } = await scrapeArticles(browser, siteUrl, daysBack);
            const limited = articles.slice(0, maxPerSite);

            if (!limited.length) {
              const reason = meta.raw_count === 0
                ? 'nenhum elemento compativel'
                : meta.title_filtered === meta.raw_count
                  ? 'possivel bloqueio anti-bot'
                  : `${meta.date_filtered} artigos fora do periodo`;
              allArticles.push({ site: siteUrl, articles_found: 0, reason });
            }

            for (const article of limited) {
              console.error(`[fetch] Extraindo: ${article.link}`);
              try {
                article.text = await fetchArticleText(browser, article.link);
              } catch {
                article.text = '(nao foi possivel extrair o texto completo)';
              }
              allArticles.push({ site: siteUrl, ...article });
            }
          } catch (error) {
            console.error(`[fetch] Erro em ${siteUrl}:`, error.message);
            allArticles.push({ site: siteUrl, error: error.message });
          }
        }
      } finally {
        await browser.close();
      }

      return { content: [{ type: 'text', text: JSON.stringify(allArticles, null, 2) }] };
    }

    if (name === 'summarize_news_groq') {
      const { title, text, link, model } = args;
      const parsed = await summarize(groq, title, text, link, model);
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    }

    if (name === 'generate_google_doc') {
      const { doc_title, news_items, folder_id } = args;
      const googleAuth = resolveGoogleAuthConfig(process.env, __dirname);
      const docSharingConfig = resolveDocSharingConfig(process.env);
      const targetFolder = folder_id?.trim() || process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null;
      const googleClients = buildGoogleClients(googleAuth);
      const { docs, drive } = googleClients;
      await validateGoogleAccess(googleAuth, googleClients, targetFolder);
      const docLink = await createGoogleDoc(
        docs,
        drive,
        doc_title,
        news_items,
        targetFolder,
        googleAuth,
        docSharingConfig,
      );
      const docId = docLink.match(/\/d\/([^/]+)\//)?.[1];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, doc_id: docId, doc_link: docLink }, null, 2),
        }],
      };
    }

    if (name === 'filter_news_by_persona') {
      const { articles, persona_ids } = args;
      const personasPath = path.join(__dirname, 'personas.json');
      if (!fs.existsSync(personasPath)) {
        return { content: [{ type: 'text', text: 'personas.json nao encontrado.' }], isError: true };
      }
      const allPersonas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
      const personas = persona_ids?.length
        ? allPersonas.filter((persona) => persona_ids.includes(persona.id))
        : allPersonas;

      const result = {};
      for (const persona of personas) {
        const indices = await filterByPersona(groq, articles, persona);
        result[persona.id] = {
          persona_nome: persona.nome,
          artigos: indices.map((index) => articles[index]).filter(Boolean),
        };
        console.error(`[filter] ${persona.nome}: ${indices.length} artigo(s) selecionado(s).`);
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    return {
      content: [{ type: 'text', text: `Tool desconhecida: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: formatToolError(error) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[MCP] Servidor mcp-news-automation iniciado via stdio.');
