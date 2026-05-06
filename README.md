# Clipping de Noticias com IA

Pipeline em Node.js para coletar noticias de portais, filtrar por persona com IA, resumir os artigos e salvar um Google Doc por cliente.

O projeto roda por linha de comando e tambem pode ser exposto como servidor MCP via `stdio`. Nao existe interface web neste repositorio.

## Resumo rapido

Entrada:

- lista de portais em `NEWS_SITES`
- personas em `personas.json`
- credenciais Groq + Google

Processamento:

1. raspa os portais com Puppeteer
2. remove duplicados
3. consulta o historico local para evitar repeticao
4. pre-seleciona artigos por persona com Groq
5. extrai o texto completo dos aprovados
6. resume os artigos com IA
7. cria um Google Doc por persona

Saida:

- 1 Google Doc por persona
- titulo do Doc no Drive no formato `DD-MM-AAAA | Nome da Persona`
- historico salvo em `news-history.json`

## Como o fluxo funciona

### 1. Coleta

O arquivo [`run.js`](./run.js) le os sites configurados no `.env` e usa [`lib/scraper.js`](./lib/scraper.js) para encontrar titulos, links e datas.

Quando o portal expõe datas relativas em PT-BR, o parser tambem entende formatos como `há 2 horas`, `há 3 dias` e `ontem` para respeitar `NEWS_DAYS_BACK`.

### 2. Limpeza

Antes de chamar a IA, o pipeline remove duplicados por link normalizado e por titulo/origem usando [`lib/history.js`](./lib/history.js).

### 3. Anti-repeticao

O projeto mantem um historico local em `news-history.json`. Esse arquivo registra por persona:

- `link`
- `title` (titulo original do artigo, quando disponivel)
- `chamada`
- `resumo`
- chaves normalizadas de comparacao
- `sentAt`
- `docTitle`
- `docLink`

Esse historico e usado de duas formas:

1. comparacao deterministica no codigo para bloquear repeticao exata por link e por identidade normalizada do artigo
2. envio de um recorte compacto do historico recente para a IA, para ela evitar repeticao semantica mesmo quando o titulo atual vier reescrito

Se o historico local ainda nao existir, o pipeline tenta bootstrapar o contexto buscando os Docs recentes daquela persona no Google Drive dentro da janela de lookback.

### 4. Selecao por persona

[`lib/ai.js`](./lib/ai.js) envia uma unica chamada para Groq com:

- titulos coletados
- descricao de cada persona
- prioridades
- lista de assuntos a evitar
- recorte compacto das noticias recentes ja enviadas, incluindo titulo, chamada, resumo e link

Com isso, a IA devolve os indices dos artigos relevantes para cada persona.

Para controlar custo, o projeto nao envia o historico inteiro para a IA. Ele manda apenas uma janela pequena dos itens mais recentes, enquanto o restante continua sendo comparado localmente no codigo.

### 5. Resumo

Para cada artigo aprovado, o pipeline extrai o texto completo e pede um JSON com:

- `chamada`
- `resumo`
- `link`

### 6. Geracao do Google Doc

[`lib/google.js`](./lib/google.js) cria um Google Doc e salva na pasta configurada no Drive. O nome do arquivo agora segue este padrao:

```text
06-05-2026 | Marcos Fernandes
```

O conteudo do Doc e montado em secoes com chamada, resumo e link de cada noticia.

## Estrutura do projeto

```text
projetoClipping/
|-- .github/
|   `-- workflows/
|       `-- ci.yml
|-- lib/
|   |-- ai.js
|   |-- errors.js
|   |-- google.js
|   |-- history.js
|   |-- personas.js
|   |-- scraper.js
|   `-- utils.js
|-- test/
|   `-- run-tests.js
|-- .env.example
|-- .gitattributes
|-- .gitignore
|-- auth-google.js
|-- doctor.js
|-- index.js
|-- LICENSE
|-- package-lock.json
|-- package.json
|-- personas.example.json
|-- README.md
|-- run.js
`-- start.bat
```

## Requisitos

- Node.js 18+
- conta Groq com `GROQ_API_KEY`
- projeto Google Cloud com `Google Docs API` e `Google Drive API`

## Instalacao

```bash
git clone https://github.com/seu-usuario/projetoClipping.git
cd projetoClipping
npm install
copy .env.example .env
copy personas.example.json personas.json
```

## Arquivos de configuracao

### `.env`

Copie `.env.example` para `.env` e preencha os valores.

Variaveis principais:

```env
GROQ_API_KEY=
GOOGLE_SERVICE_ACCOUNT_PATH=./google-credentials.json
GOOGLE_IMPERSONATE_USER=
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DOC_SHARE_MODE=restricted
NEWS_SITES=https://www.forbes.com.br,https://g1.globo.com,https://www.infomoney.com.br
NEWS_DAYS_BACK=3
NEWS_REPEAT_LOOKBACK_DAYS=14
NEWS_HISTORY_PATH=./news-history.json
MAX_ARTICLES_PER_SITE=20
MAX_ARTICLES_PER_PERSONA=15
```

Observacoes importantes:

- `GOOGLE_SERVICE_ACCOUNT_PATH` e o modo recomendado.
- `GOOGLE_IMPERSONATE_USER` so deve ser usado se voce tiver Google Workspace com domain-wide delegation.
- `GOOGLE_DRIVE_FOLDER_ID` deve apontar para a pasta onde os Docs serao criados.
- `NEWS_HISTORY_PATH` precisa apontar para um arquivo dentro do projeto.

### `personas.json`

Copie `personas.example.json` para `personas.json`.

Campos esperados por persona:

- `id` unico
- `nome`
- `descricao`
- `prioridades` (opcional)
- `evitar` (opcional)

Exemplo:

```json
[
  {
    "id": "marcos_fernandes",
    "nome": "Marcos Fernandes",
    "descricao": "CEO com foco em mercado financeiro, negocios e movimentos de empresas.",
    "prioridades": [
      "mercado financeiro",
      "resultados de empresas",
      "fusoes e aquisicoes"
    ],
    "evitar": [
      "entretenimento",
      "campanhas publicitarias sem impacto de negocio"
    ]
  }
]
```

## Google: modos de autenticacao

### Opcao recomendada: Service Account

1. Crie uma service account no Google Cloud.
2. Ative `Google Drive API` e `Google Docs API`.
3. Baixe a chave JSON.
4. Salve o arquivo no caminho configurado em `GOOGLE_SERVICE_ACCOUNT_PATH`.
5. Compartilhe a pasta alvo com o `client_email` da service account.
6. Se a conta nao usa `GOOGLE_IMPERSONATE_USER`, prefira uma pasta em `Shared Drive`.

### Fallback: OAuth manual

Use somente se voce nao puder usar service account.

Variaveis necessarias:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Depois execute:

```bash
npm run auth-google
```

Isso gera `google-token.json` localmente. O fluxo usa `state` no callback local para reduzir risco de troca indevida de codigo OAuth.

## Como executar

### Validar configuracao

```bash
npm run doctor
```

Esse comando valida:

- `.env`
- `personas.json`
- estrutura das personas
- `id` unico por persona
- autenticacao Google
- permissao de escrita na pasta do Drive
- modo de compartilhamento do Doc

### Rodar o pipeline

```bash
npm start
```

No Windows, tambem existe o atalho:

```bash
start.bat
```

Fluxo esperado no terminal:

```text
[13:21:04] [2/5] Pre-selecionando artigos para 2 persona(s)...
[13:21:06]            Oseias Gomes: 15 artigo(s) pre-selecionado(s)
[13:22:03] [4/5] Resumindo com IA (Groq)...
[13:23:10] [5/5] Criando Google Docs por persona...
[13:23:12]            OK  Marcos Fernandes  (15 artigo(s))
                   https://docs.google.com/document/d/SEU_DOC_ID/edit
```

### Rodar como MCP

```bash
npm run mcp
```

As tools expostas por [`index.js`](./index.js) sao:

- `fetch_portal_news`
- `summarize_news_groq`
- `filter_news_by_persona`
- `generate_google_doc`

Observacao:

- `fetch_portal_news` e `generate_google_doc` nao dependem da Groq
- `summarize_news_groq` e `filter_news_by_persona` exigem `GROQ_API_KEY`

Exemplo de configuracao:

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

## Historico e nome dos Docs

### Formato atual do nome do arquivo

Todo Doc criado pelo pipeline principal usa:

```text
DD-MM-AAAA | Nome da Persona
```

Exemplo:

```text
06-05-2026 | Marcos Fernandes
```

### Compatibilidade com Docs antigos

Ao tentar reconstruir o historico, o projeto reconhece:

- o formato atual `DD-MM-AAAA | Nome da Persona`
- o formato legado `Clipping Nome da Persona - DD/MM/AAAA`

### Reset do historico

Se voce quiser permitir que noticias antigas voltem a entrar:

- apague `news-history.json`; ou
- reduza `NEWS_REPEAT_LOOKBACK_DAYS`; ou
- edite o arquivo manualmente

No proximo run, o historico e recriado automaticamente.

### Impacto em token

O historico rico com `title`, `chamada`, `resumo` e `link` fica salvo localmente sem custo adicional.

O custo de token so acontece quando parte desse historico e enviada para a IA. Para evitar inflacao de custo, o projeto manda apenas um recorte recente e resumido do historico por persona, em vez do arquivo inteiro.

## Publicacao no Git e arquivos locais

O repositorio foi ajustado para ignorar:

- `.env`
- `personas.json`
- `google-credentials.json`
- `google-token.json`
- `news-history.json`
- chaves locais como `*.pem`, `*.p12`, `*.key`, `*.crt`, `*.cer`
- `node_modules/`
- logs e caches temporarios

Arquivos que devem continuar versionados:

- `.env.example`
- `personas.example.json`
- codigo-fonte
- testes
- documentacao

Antes de publicar:

1. rode `npm run check`
2. rode `npm test`
3. rode `npm run doctor`
4. confira se nenhum segredo ficou em um nome fora do padrao ignorado

## Troubleshooting

### `personas.json nao encontrado`

Crie o arquivo com base em `personas.example.json`.

### Service account sem acesso ao Drive

Verifique:

1. se a pasta foi compartilhada com o email da service account
2. se `GOOGLE_DRIVE_FOLDER_ID` aponta para a pasta certa
3. se a pasta esta em `Shared Drive` quando nao houver impersonacao

### OAuth expirou

Rode `npm run auth-google` novamente.

Se o refresh token estiver expirando rapido, coloque o app OAuth em `In production`.

### Nenhum artigo encontrado

Revise:

- `NEWS_SITES`
- `NEWS_DAYS_BACK`
- bloqueios anti-bot
- mudancas no HTML dos portais

### Noticias fora de contexto

Ajuste o `personas.json`:

- deixe a `descricao` mais objetiva
- refine `prioridades`
- preencha `evitar` com o que realmente deve ser bloqueado

## Testes e validacao

```bash
npm run check
npm test
```

O CI em `.github/workflows/ci.yml` roda essas duas validacoes automaticamente em push e pull request.

## Licenca

MIT
