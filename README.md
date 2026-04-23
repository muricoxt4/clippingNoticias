# Clipping de Noticias com IA

Pipeline que coleta noticias de portais brasileiros, seleciona o que e relevante para cada persona com IA, resume as materias e gera um Google Doc por cliente.

## Fluxo

```text
Portais de noticias
  -> Puppeteer coleta titulos e links
  -> Groq faz a pre-selecao por persona
  -> Puppeteer extrai texto completo so dos artigos aprovados
  -> Groq resume os artigos
  -> Google Docs gera um documento por persona
```

## Funcionalidades

- Scraping de multiplos portais com Puppeteer
- Pre-selecao em lote por persona com Groq
- Cache de artigos compartilhados entre personas
- Geracao automatica de Google Docs formatados
- Execucao manual via `run.js`
- Exposicao das ferramentas via MCP em `index.js`

## Requisitos

- Node.js 18+
- Conta Google Cloud com Google Docs API e Google Drive API ativadas
- Chave de API Groq

## Instalacao

```bash
git clone https://github.com/seu-usuario/projetoClipping.git
cd projetoClipping
npm install
copy .env.example .env
copy personas.example.json personas.json
node auth-google.js
```

## Configuracao

### `.env`

```env
GROQ_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_FOLDER_ID=
NEWS_SITES=https://www.forbes.com.br,https://g1.globo.com,https://www.infomoney.com.br
NEWS_DAYS_BACK=3
```

### `personas.json`

Crie o arquivo a partir de `personas.example.json`. Cada persona precisa de:

- `id`
- `nome`
- `descricao`

Quanto mais detalhada a descricao, melhor a curadoria.

## Como usar

### Pipeline completo

```bash
node run.js
# ou
npm run run-now
```

No Windows, voce tambem pode usar `start.bat`.

### Autenticacao Google

```bash
node auth-google.js
```

O token sera salvo localmente em `google-token.json`.

## MCP

O `index.js` implementa um servidor MCP com estas tools:

- `fetch_portal_news`
- `summarize_news_groq`
- `filter_news_by_persona`
- `generate_google_doc`

Exemplo de configuracao no Claude Desktop:

```json
{
  "mcpServers": {
    "news-automation": {
      "command": "node",
      "args": ["C:/caminho/completo/projetoClipping/index.js"]
    }
  }
}
```

## Estrutura

```text
projetoClipping/
|-- lib/
|   |-- ai.js
|   |-- google.js
|   |-- scraper.js
|   `-- utils.js
|-- auth-google.js
|-- index.js
|-- run.js
|-- start.bat
|-- personas.example.json
|-- .env.example
|-- package.json
`-- README.md
```

## Licenca

MIT
