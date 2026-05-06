# Clipping de Noticias com IA

Pipeline em Node.js para coletar noticias de portais, filtrar por persona com IA, resumir os artigos e gerar um Google Doc por cliente.

O repositorio foi reorganizado para deixar apenas `run.js` e `README.md` como arquivos de entrada na raiz. Todo o restante fica concentrado dentro de `app/`.

## Estrutura

```text
projetoClipping/
|-- app/
|   |-- config/
|   |   |-- .env
|   |   |-- .env.example
|   |   |-- personas.json
|   |   `-- personas.example.json
|   |-- credentials/
|   |   |-- google-credentials.json
|   |   `-- google-token.json
|   |-- data/
|   |   `-- news-history.json
|   |-- scripts/
|   |   `-- start.bat
|   |-- src/
|   |   |-- cli/
|   |   |   |-- auth-google.js
|   |   |   |-- doctor.js
|   |   |   `-- run.js
|   |   |-- lib/
|   |   |   |-- ai.js
|   |   |   |-- errors.js
|   |   |   |-- google.js
|   |   |   |-- history.js
|   |   |   |-- paths.js
|   |   |   |-- personas.js
|   |   |   |-- scraper.js
|   |   |   `-- utils.js
|   |   `-- mcp/
|   |       `-- index.js
|   |-- test/
|   |   `-- run-tests.js
|   |-- LICENSE
|   |-- package-lock.json
|   `-- package.json
|-- run.js
`-- README.md
```

## Como executar

### 1. Instalar dependencias

```bash
cd app
npm install
```

### 2. Preparar configuracao

```bash
copy config\.env.example config\.env
copy config\personas.example.json config\personas.json
```

Arquivos locais esperados:

- `app/config/.env`
- `app/config/personas.json`
- `app/credentials/google-credentials.json` ou `app/credentials/google-token.json`
- `app/data/news-history.json` sera criado automaticamente se nao existir

### 3. Validar ambiente

```bash
cd app
npm run doctor
```

### 4. Rodar o pipeline

Opcao pela raiz do repositorio:

```bash
node run
```

ou:

```bash
node run.js
```

Opcao dentro de `app/`:

```bash
cd app
npm start
```

No Windows, tambem existe:

```bash
run.bat
start.bat
app\scripts\start.bat
```

## MCP

Para subir o servidor MCP:

```bash
cd app
npm run mcp
```

Entry point do servidor:

- `app/src/mcp/index.js`

Tools expostas:

- `fetch_portal_news`
- `summarize_news_groq`
- `filter_news_by_persona`
- `generate_google_doc`

Exemplo de configuracao:

```json
{
  "mcpServers": {
    "news-automation": {
      "command": "node",
      "args": ["C:/caminho/completo/projetoClipping/app/src/mcp/index.js"]
    }
  }
}
```

## Configuracao

### `.env`

O arquivo base fica em `app/config/.env.example`.

Principais variaveis:

```env
GROQ_API_KEY=
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/google-credentials.json
GOOGLE_IMPERSONATE_USER=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DOC_SHARE_MODE=restricted
NEWS_SITES=https://www.forbes.com.br,https://g1.globo.com,https://www.infomoney.com.br
NEWS_DAYS_BACK=3
NEWS_REPEAT_LOOKBACK_DAYS=14
NEWS_HISTORY_PATH=./data/news-history.json
MAX_ARTICLES_PER_SITE=20
MAX_ARTICLES_PER_PERSONA=15
```

Observacoes:

- `GOOGLE_SERVICE_ACCOUNT_PATH` e resolvido a partir de `app/`.
- `NEWS_HISTORY_PATH` precisa apontar para um arquivo dentro de `app/`.
- se usar OAuth manual, o token sera salvo em `app/credentials/google-token.json`.

### `personas.json`

Copie `app/config/personas.example.json` para `app/config/personas.json`.

Campos por persona:

- `id`
- `nome`
- `descricao`
- `prioridades` opcional
- `evitar` opcional

## Google

### Modo recomendado: service account

1. Ative `Google Docs API` e `Google Drive API`.
2. Baixe a chave JSON.
3. Salve em `app/credentials/google-credentials.json`.
4. Compartilhe a pasta de destino com o `client_email` da service account.

### Fallback: OAuth manual

```bash
cd app
npm run auth-google
```

O token sera salvo em `app/credentials/google-token.json`.

## Fluxo do pipeline

1. Raspa os portais configurados em `NEWS_SITES`.
2. Remove duplicados por link normalizado e por titulo/origem.
3. Consulta `app/data/news-history.json` para evitar repeticao.
4. Faz pre-selecao por persona com Groq.
5. Extrai o texto completo dos aprovados.
6. Resume os artigos com IA.
7. Cria um Google Doc por persona.

Formato do nome do Doc:

```text
DD-MM-AAAA | Nome da Persona
```

Exemplo:

```text
06-05-2026 | Marcos Fernandes
```

## Historico

O historico local fica, por padrao, em `app/data/news-history.json`.

Para resetar:

- apague `app/data/news-history.json`; ou
- reduza `NEWS_REPEAT_LOOKBACK_DAYS`; ou
- edite o arquivo manualmente

## Testes e validacao

```bash
cd app
npm run check
npm test
```

O CI em [ci.yml](./.github/workflows/ci.yml) executa essas validacoes dentro de `app/`.

## Troubleshooting

### `.env nao encontrado`

Crie `app/config/.env` a partir de `app/config/.env.example`.

### `personas.json nao encontrado`

Crie `app/config/personas.json` a partir de `app/config/personas.example.json`.

### Problemas com Google Drive

Verifique:

1. se a pasta foi compartilhada com a conta correta;
2. se `GOOGLE_DRIVE_FOLDER_ID` aponta para a pasta certa;
3. se a service account tem permissao de escrita.

## Licenca

MIT. O arquivo esta em `app/LICENSE`.
