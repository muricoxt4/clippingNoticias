# Clipping de Noticias com IA

Pipeline em Node.js para coletar noticias de portais brasileiros, selecionar o que e relevante para cada persona com IA, resumir os artigos e gerar um Google Doc por cliente.

## Interface atual

O projeto hoje roda como:

- CLI local via terminal (`npm start` / `start.bat`)
- servidor MCP via `stdio` (`npm run mcp`)

O projeto **nao** possui interface web neste momento. Ele tambem **nao** abre navegador para a execucao do clipping, exceto no fluxo opcional de autenticacao OAuth do Google (`npm run auth-google`).

## O que o projeto faz

```text
Portais de noticias
  -> coleta de titulos e links com Puppeteer
  -> pre-selecao por persona com Groq
  -> extracao do texto completo dos artigos aprovados
  -> resumo estruturado por IA
  -> geracao de Google Docs por persona
```

## Fluxo principal

- `npm start`: executa o pipeline completo (`run.js`)
- `npm run doctor`: valida configuracao local, personas e acesso ao Google
- `npm run mcp`: sobe o servidor MCP (`index.js`)
- `npm run auth-google`: gera `google-token.json` para o fallback OAuth
- `npm run check`: valida a sintaxe dos arquivos JS
- `npm test`: executa testes locais das regras criticas do pipeline

## Requisitos

- Node.js 18+
- Conta Groq com `GROQ_API_KEY`
- Projeto no Google Cloud com:
  - `Google Drive API`
  - `Google Docs API`

## Instalacao

```bash
git clone https://github.com/seu-usuario/projetoClipping.git
cd projetoClipping
npm install
copy .env.example .env
copy personas.example.json personas.json
```

## Configuracao

### 1. Variaveis de ambiente

Use o arquivo `.env` com base em `.env.example`.

Configuracao recomendada:

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

### 1.1 Observacao sobre `NEWS_SITES`

`NEWS_SITES` aceita uma lista de URLs separadas por virgula. O scraping foi desenhado para portais jornalisticos, mas a compatibilidade varia por site e pode mudar sem aviso por causa de:

- alteracao de HTML
- bloqueios anti-bot
- secoes com muito conteudo dinamico
- ausencia de data estruturada

Exemplos de portais usados neste projeto:

- `https://www.forbes.com.br`
- `https://g1.globo.com`
- `https://www.infomoney.com.br`
- `https://revistapegn.globo.com`
- `https://www.meioemensagem.com.br`
- `https://braziljournal.com`
- `https://exame.com`
- `https://neofeed.com.br`
- `https://epocanegocios.globo.com`
- `https://vocesa.abril.com.br`

### 2. Google - modo recomendado: Service Account

1. Crie uma `service account` no Google Cloud.
2. Ative `Google Drive API` e `Google Docs API`.
3. Baixe a chave JSON.
4. Salve o arquivo dentro do projeto no caminho configurado em `GOOGLE_SERVICE_ACCOUNT_PATH`.
5. Compartilhe a pasta de destino com o `client_email` dessa service account.
6. Para `service account` pura, use uma pasta dentro de `Shared Drive`.
7. Por seguranca, os Docs ficam `restricted` por padrao. So use `GOOGLE_DOC_SHARE_MODE=anyone_reader` se voce realmente quiser links publicos.

### 3. Google - fallback OAuth manual

Use esse modo somente se voce nao puder usar `Shared Drive` ou `service account`.

Variaveis necessarias:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Depois rode:

```bash
npm run auth-google
```

Isso gera `google-token.json` localmente.

### 4. Personas

Crie `personas.json` a partir de `personas.example.json`.

Cada persona precisa de:

- `id`
- `nome`
- `descricao`
- `prioridades` (opcional, lista de focos primarios)
- `evitar` (opcional, lista de assuntos que devem ser descartados)

Exemplo:

```json
[
  {
    "id": "marcos_fernandes",
    "nome": "Marcos Fernandes",
    "descricao": "Empresario e CEO com foco em leitura executiva sobre mercado financeiro, negocios e empresas.",
    "prioridades": [
      "mercado financeiro",
      "resultados de empresas",
      "fusoes e aquisicoes",
      "macroeconomia com impacto em negocios"
    ],
    "evitar": [
      "marketing tatico",
      "campanhas publicitarias sem relevancia de negocio",
      "entretenimento sem impacto economico"
    ]
  }
]
```

O pipeline cria e consulta `news-history.json` automaticamente para evitar repetir artigos ja enviados recentemente para a mesma persona. Se o arquivo ainda nao existir, ele tenta bootstrapar esse historico a partir do ultimo clipping encontrado no Google Docs para cada persona.

### 4.1 Reset do historico anti-repeticao

Se voce quiser permitir que noticias antigas voltem a ser consideradas:

- apague `news-history.json`; ou
- aumente/reduza `NEWS_REPEAT_LOOKBACK_DAYS`; ou
- edite manualmente o arquivo para remover apenas uma persona ou item especifico

No proximo run, o pipeline recria o historico automaticamente. Se o arquivo estiver vazio, ele tenta reconstruir o contexto a partir do ultimo Google Doc encontrado para cada persona.

## Como usar

### Validar configuracao antes de rodar

```bash
npm run doctor
```

Use isso para validar:

- `.env`
- `personas.json`
- formato das personas
- autenticacao Google
- acesso de escrita na pasta alvo
- modo de compartilhamento do Doc

### Rodar o pipeline

```bash
npm start
```

O pipeline:

1. raspa os portais configurados
2. remove duplicados antes da IA
3. consulta o historico anti-repeticao
4. pre-seleciona noticias por persona
5. extrai o texto completo dos artigos escolhidos
6. resume os textos com Groq
7. cria um Google Doc por persona

No Windows, voce tambem pode usar:

```bash
start.bat
```

### Exemplo de saida esperada

Trecho tipico do terminal:

```text
[13:21:04] [2/5] Pre-selecionando artigos para 2 persona(s)...
[13:21:06]            Oseias Gomes: 15 artigo(s) pre-selecionado(s)
[13:21:06]            Marcos Fernandes: 15 artigo(s) pre-selecionado(s)
[13:22:03] [4/5] Resumindo com IA (Groq)...
[13:23:10] [5/5] Criando Google Docs por persona...
[13:23:12]            OK  Marcos Fernandes  (15 artigo(s))
                   https://docs.google.com/document/d/SEU_DOC_ID/edit
```

Resultado final esperado:

- um Google Doc por persona com chamada, resumo e link dos artigos
- atualizacao do `news-history.json`
- logs no terminal com total coletado, total unico e avisos de scraping/extracao

## Tratamento de erros

O pipeline agora falha com um bloco resumido no terminal, incluindo:

- etapa em que a falha ocorreu
- persona e artigo atual, quando aplicavel
- progresso acumulado
- lista curta de avisos de scraping/extracao
- mensagem orientada para Groq, Google ou timeout

Exemplos de falhas cobertas:

- `Groq 429 / rate_limit_exceeded`
- token OAuth expirado ou revogado
- service account sem acesso a `Shared Drive`
- timeout em scraping

## Dicas para limitar custo e rate limit da Groq

Se bater limite de tokens:

- reduza `MAX_ARTICLES_PER_SITE`
- reduza `MAX_ARTICLES_PER_PERSONA`
- reduza `NEWS_DAYS_BACK`
- rode novamente apos o reset da cota

Se o volume continuar alto:

- reduza a quantidade de portais em `NEWS_SITES`
- deixe personas mais objetivas
- evite perfis muito amplos, pois eles puxam mais artigos para resumir

## Troubleshooting

### Google service account falha no `doctor`

Verifique nesta ordem:

1. a chave JSON apontada em `GOOGLE_SERVICE_ACCOUNT_PATH` existe mesmo no caminho informado
2. `Google Drive API` e `Google Docs API` estao ativadas no projeto do Google Cloud
3. a pasta de destino foi compartilhada com o `client_email` da service account
4. se estiver usando service account pura, a pasta esta em `Shared Drive`
5. se estiver usando `My Drive` de um usuario, voce configurou `GOOGLE_IMPERSONATE_USER` com delegacao de dominio

### OAuth manual falha ou expira

- rode `npm run auth-google` novamente
- se o refresh token expirar toda semana, coloque o app OAuth em `In production`
- se nao vier `refresh_token`, revogue o app em `myaccount.google.com/permissions` e autorize de novo

### Nenhum artigo encontrado

Verifique:

- se as URLs em `NEWS_SITES` apontam para paginas de noticias e nao paginas institucionais
- se `NEWS_DAYS_BACK` nao esta muito baixo
- se o portal mudou o HTML
- se o portal esta bloqueando scraping

### Vieram noticias fora de contexto

Revise primeiro o `personas.json`:

- deixe `descricao` mais objetiva
- use `prioridades` para dizer o que deve entrar
- use `evitar` para dizer o que precisa ser bloqueado

### Vieram noticias repetidas

Verifique:

- se `news-history.json` existe
- se `NEWS_REPEAT_LOOKBACK_DAYS` nao esta baixo demais
- se o Doc anterior daquela persona foi encontrado quando o historico local ainda estava vazio

## Limitacoes conhecidas

- O scraping depende do HTML atual de cada portal e pode quebrar sem mudanca no codigo.
- Alguns portais nao expoem data de forma confiavel; nesses casos, a IA avalia mais pelo titulo.
- O projeto depende de quota da Groq; em cota baixa, o pipeline pode parar no resumo.
- O bootstrap do historico depende de encontrar Docs antigos com nome no formato `Clipping <Nome> - <data>`.
- O projeto atual nao possui interface web, autenticacao de usuarios nem painel administrativo.

## MCP

O arquivo `index.js` expoe estas tools:

- `fetch_portal_news`
- `summarize_news_groq`
- `filter_news_by_persona`
- `generate_google_doc`

Exemplo de uso no Claude Desktop:

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
|-- .github/
|   `-- workflows/
|       `-- ci.yml
|-- lib/
|   |-- ai.js
|   |-- errors.js
|   |-- google.js
|   |-- history.js
|   |-- scraper.js
|   `-- utils.js
|-- auth-google.js
|-- doctor.js
|-- index.js
|-- run.js
|-- start.bat
|-- test/
|   `-- run-tests.js
|-- personas.example.json
|-- .env.example
|-- .gitattributes
|-- LICENSE
|-- package.json
`-- README.md
```

## Publicacao no GitHub

Antes de subir:

1. Rode `npm run check`
2. Rode `npm test`
3. Rode `npm run doctor`
4. Confirme que arquivos sensiveis nao estao versionados:
   - `.env`
   - `personas.json`
   - `google-credentials.json`
   - `google-token.json`
   - `news-history.json`

O `.gitignore` ja cobre esses arquivos.
5. Revise se `GOOGLE_DOC_SHARE_MODE` esta em `restricted` antes de produzir material sensivel.
6. O repositorio inclui CI em `.github/workflows/ci.yml` para rodar `npm run check` e `npm test` automaticamente.

## Licenca

MIT
