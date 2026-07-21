# Tichr — Backend

API do Tichr, um sistema de agendamento de aulas **orientado a regras**: em vez de o
professor cadastrar aula por aula, o backend **projeta as aulas** a partir das regras da
turma (dias da semana + modalidade) e dos descontos do calendário (exceções e férias).

Sobre esse núcleo, o backend também policia **planos/assinaturas** (limite de turmas
ativas), orquestra **dinâmicas de grupos** (sorteio de squads), persiste **equipes** e
**cargos** (agrupamento manual e atribuição de papéis aos membros) e sustenta o **portal
gamificado do aluno** (acesso por PIN, pontuação configurável e ranking).

Stack: **NestJS 11** + **Firebase Firestore** (dados) + **Firebase Auth** (identidade do
professor) + **JWT** (`@nestjs/jwt`, identidade do aluno).
Padrão **Controller → Service → Repository**, com as regras de negócio nas **entidades**.

---

## Sumário

- [Setup](#setup)
- [Arquitetura](#arquitetura)
- [Estrutura de dados](#estrutura-de-dados-firestore)
- [Endpoints](#endpoints)
- [Regras de negócio](#regras-de-negócio)
  - [Planos e cota de turmas](#planos-e-cota-de-turmas)
  - [Orquestração de grupos](#orquestração-de-grupos-squads)
  - [Equipes, distribuição e cargos](#equipes-distribuição-e-cargos)
  - [Gamificação (XP, ranking e config)](#gamificação-xp-ranking-e-config)
  - [Portal do aluno (@username + PIN)](#portal-do-aluno-username--pin-da-turma)
  - [Tichr Qlick (quiz em tempo real, CQRS)](#tichr-qlick-quiz-em-tempo-real-cqrs)
  - [Painel Administrativo e feedback](#painel-administrativo-backoffice-e-cupons)
- [Tichr Wor (guerra de castelos)](#tichr-wor-guerra-de-castelos-pvp-em-tempo-real)
- [Tichr Isolateus (dedução social)](#tichr-isolateus-dedução-social--defesa-pedagógica)

---

## Setup

```bash
npm install
npm run start:dev      # dev (watch) em http://localhost:3000
npm run build && npm run start:prod
npm test               # testes unitários do motor (Jest)
```

### Variáveis de ambiente (`.env`)

| Variável | Descrição |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON da service account do Firebase Admin, **em base64**. |
| `FIREBASE_WEB_API_KEY` | Web API key do Firebase (pública). Autentica o login por email/senha via Identity Toolkit REST. |
| `FIREBASE_STORAGE_BUCKET` | Bucket do Storage das fotos de perfil (opcional). Default: `<project_id>.firebasestorage.app`; projetos antigos usam `<project_id>.appspot.com`. |
| `JWT_SECRET` | Segredo para assinar/validar o JWT do portal do aluno. **Defina em produção** (há um fallback de desenvolvimento). |
| `CORS_ORIGINS` | Origens autorizadas, separadas por vírgula (ex.: `https://tichr.com.br,https://www.tichr.com.br`). **Obrigatória em produção:** o CORS agora usa credenciais (cookie de sessão) e `Allow-Origin: *` é incompatível — sem a env, nenhuma origem passa e o app para. É env, e não constante, porque os *preview deploys* da Vercel mudam de URL a cada branch. Default de dev: `http://localhost:4200`. |
| `APP_BASE_URL` | URL pública do app (default `https://tichr.com.br`). É o `continueUrl` dos e-mails de confirmação/redefinição — traz o professor de volta depois do clique. O domínio precisa estar nos *authorized domains* do projeto Firebase, senão o link é rejeitado. |
| `GEMINI_API_KEY` | Chave do Google Gemini (Vercel). Habilita a geração por IA do **Tichr Wor** (arsenal) e do **Tichr Qlick** (perguntas); sem ela, criação manual. |
| `RESEND_API_KEY` | Chave da Resend — alerta por e-mail quando chega um feedback. **Não obrigatória:** sem ela o feedback é salvo normalmente e a inbox exibe *"alerta não enviado"*. O professor nunca perde o relato por causa de e-mail mal configurado. |
| `RESEND_FROM` | Remetente do alerta (opcional, default `Tichr <nao-responda@tichr.com.br>`). O domínio precisa estar **verificado** na Resend — sem verificação, ela só entrega para o e-mail do dono da conta. |
| `ABACATE_API_KEY` | Chave da **Abacate Pay** (gateway de pagamento — PIX e cartão). Sem ela o checkout fica indisponível (503). Comece com a chave de **dev**. |
| `ABACATE_WEBHOOK_SECRET` | Segredo do webhook: vai na query da URL registrada no painel (`/checkout/webhook?webhookSecret=…`) e é conferido a cada callback. **Defina o mesmo valor aqui e no painel.** |
| `ABACATE_DEV_MODE` | Ambiente do gateway. Ausente/`true` = devMode (permite `POST /checkout/simular/:id` para testar sem PIX real). Em produção, `false`. |
| `PORT` | Porta do servidor (opcional, default `3000`). |

> A service account (Admin SDK) **não** valida senhas — por isso a Web API key é
> necessária para o login. Veja [Autenticação](#autenticação).

---

## Arquitetura

```
Controller  ── recebe HTTP, valida DTO (class-validator)
   │
Service     ── orquestra: carrega entidades, invoca regras, persiste
   │
Repository  ── I/O no Firestore; devolve SEMPRE instâncias de entidade
   │            (class-transformer plainToInstance) — nunca JSON puro
Firestore
```

- **Entidades** (`*.entity.ts`): modelam o documento e concentram as regras de negócio
  (ex.: `TurmaEntity.projetarSessoes()` é o motor de agendamento).
- **Repositório genérico** (`FirestoreRepository<T>`): `create`, `findById`, `findBy`,
  `update`, `delete`, `deleteBy`. Serializa a entidade para objeto plano antes de gravar
  (o Firestore recusa objetos com protótipo customizado).
- **Módulos**: `FirebaseModule` (global), `AuthModule` (login de professor e aluno),
  `TurmaModule` (turmas, sessões, exceções, férias, **alunos**, **equipes**, **cargos**,
  **agrupamento**, **XP** e **ranking**), `ProfessorModule` (perfil + **checkout/planos**),
  `PlanoAulaModule` (**plano de aula**: escopo geral, **tópicos** e **alocação**),
  `QlickModule` (**Tichr Qlick**: quiz gamificado em tempo real — CQRS sobre o Firestore).
- **Datas** trafegam como string **`YYYY-MM-DD`** (dia de calendário em UTC) — elimina o
  off-by-one de fuso/horário de verão.

### Autenticação

Há **dois perfis** (`Role`): **`PROFESSOR`** (dono do painel) e **`STUDENT`** (aluno no
portal gamificado). O `AuthGuard` **global** aceita os dois tipos de token:

- Extrai o `Bearer <token>` e **tenta primeiro** validá-lo como ID token do Firebase
  (`admin.auth().verifyIdToken()`) → perfil `PROFESSOR` (o `uid` vira o `professorId`,
  injetável com `@ProfessorId()`).
- Se falhar, tenta como **JWT customizado de aluno** (`@nestjs/jwt`) → perfil `STUDENT`
  (com `alunoId` e `turmaId`, injetáveis com `@CurrentStudent()`).
- **Autorização por papel:** `@Roles(...)` define quem pode acessar a rota. **Sem o
  decorator, o padrão é `PROFESSOR`** — ou seja, todo o painel é protegido por omissão;
  as rotas do aluno declaram `@Roles('STUDENT')` e o ranking `@Roles('PROFESSOR','STUDENT')`.
- Rotas abertas usam `@Public()`.
- **Trava de e-mail verificado:** professor com `email_verified: false` recebe
  **`403 { code: 'EMAIL_NAO_VERIFICADO' }`** em todo o painel. A checagem mora no
  `canActivate`, **nunca** dentro do `resolveUser` — ali ela cairia no `catch` que tenta
  o token como sendo de aluno e viraria um 401 genérico, mandando o professor para o
  `/login` em laço em vez da tela de confirmação. `@SemVerificacao()` abre as exceções
  de que a tela de espera precisa (status, reenvio, `GET /profile` e `DELETE /profile` —
  esta última porque ninguém pode ficar preso numa conta que não consegue apagar).
  Não se aplica ao aluno, que não tem e-mail.

**Login do professor** — o backend é o intermediário: `POST /auth/login` recebe
email/senha e chama a REST do Identity Toolkit (`accounts:signInWithPassword`) com a
`FIREBASE_WEB_API_KEY`, devolvendo o ID token do Firebase. O frontend não conhece o
Firebase — só guarda o token e o envia como `Bearer`.

**Sessão: dois canais.** O **ID token** (~1h) vai no corpo da resposta e o front o manda
como `Bearer`. O **refresh token** sai num **cookie `HttpOnly`** (`tichr_rt`,
`SameSite=Lax`, `Path=/auth`, host-only) e **nunca chega ao JavaScript** — se chegasse,
um XSS o exfiltraria e teria a conta em caráter indefinido; no cookie, o pior caso é o
ID token de 1h. Isso depende de FE (`tichr.com.br`) e API (`api.tichr.com.br`)
compartilharem o domínio registrável: são **mesmo site**, e o `Lax` deixa passar.
Enquanto a API respondia em `tichr-be.vercel.app` era impossível — `vercel.app` está na
Public Suffix List, o cookie nascia *third-party* e morria no Safari.

- `POST /auth/refresh` troca o cookie por um ID token fresco (Secure Token API — outro
  host, corpo `form-urlencoded`, resposta em `snake_case`; normalizado no helper). É
  `@Public()` por definição: o ID token do chamador já expirou.
- Também é o que traz o `email_verified` atualizado sem novo login, já que a Secure Token
  API emite a partir do registro **atual** do usuário.
- Trocar **senha ou e-mail revoga os refresh tokens** no Firebase: o refresh seguinte
  responde `401 { code: 'SESSAO_EXPIRADA' }`. É o comportamento correto — o front trata
  como logout limpo, sem modal de erro.
- `POST /auth/logout` apaga o cookie; precisa existir no servidor porque o front não
  apaga um `HttpOnly` sozinho.

**CORS** — a lista de origens é **explícita** e vem de `CORS_ORIGINS`:
`Access-Control-Allow-Origin: *` é incompatível com credenciais. **Sem a env configurada,
nenhuma origem passa e o app inteiro para.**

**Ciclo de vida do e-mail** — `POST /auth/signup` dispara o `VERIFY_EMAIL` logo após
provisionar o perfil (*best-effort*: falha no envio não derruba um cadastro que deu
certo). `GET /auth/verificacao` lê o estado **ao vivo** no Auth (o claim do token fica
congelado na emissão). `POST /auth/recuperar-senha` responde **sempre** `200
{ enviado: true }`, mesmo para e-mail inexistente — distinguir os casos entregaria quem
tem conta no Tichr. `POST /auth/email` usa `VERIFY_AND_CHANGE_EMAIL`, então o e-mail só
troca quando o link chega na caixa **nova**; o antigo vale até lá.

> **O e-mail não está no Firestore.** Ele vive só no Firebase Auth, e por isso não entra
> na `ProfessorView`: o `GET /profile` roda em quase toda navegação, e buscá-lo ali
> imporia um `auth.getUser` a todas elas por causa de uma tela. Fica no `GET /auth/conta`.

**Login do aluno** — alunos não têm e-mail: `POST /auth/aluno` recebe `turmaId` + `PIN`
(4 dígitos), casa com o Firestore e emite um **JWT próprio** com
`{ role: 'STUDENT', alunoId, turmaId }` (validade 30 dias). O aluno só enxerga a própria
turma e o próprio perfil. **Nada da conta/segurança acima o afeta**: verificação, reset e
troca de e-mail são exclusivos do professor, e o token do aluno **não se renova**.

---

## Estrutura de dados (Firestore)

`professorId` = `uid` do Firebase Auth (não há coleção de professor separada da conta).

### `turmas`
Agrupa as regras de recorrência de um conjunto de aulas.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string | id do documento |
| `professorId` | string | dono (uid) |
| `nome` | string | |
| `tipoModalidade` | `'GRADE_FIXA' \| 'MODULO_FECHADO'` | ver [modalidades](#modalidades) |
| `diasSemana` | number[] | dias da aula. `0`=Dom … `6`=Sáb |
| `dataInicio` | string | `'YYYY-MM-DD'` |
| `totalAulas` | number? | obrigatório em `MODULO_FECHADO` |
| `dataFimPrevista` | string? | calculado; só em módulos |
| `cor` | string? | destaque no calendário (`#RRGGBB`) |
| `disciplina` | string? | disciplina lecionada na turma |
| `horaInicio` / `horaFim` | string? | jornada (`HH:mm`) |
| `ativo` | boolean | |
| `encerradaManualmente` | boolean? | arquivada pelo professor; deixa de contar na cota do plano |
| `pontuacaoAtiva` | boolean? | liga/desliga a pontuação da turma (default `true`) |
| `nomePontuacao` | string? | rótulo livre da pontuação (ex.: `XP`, `Aura`; default `XP`) |
| `rankingAtivo` | boolean? | liga/desliga o ranking (default `true`) |
| `rotuloAdicionar` / `rotuloRemover` | string? | rótulos dos botões de pontuar (ex.: `Moggar` / `Punir`; default `Adicionar`/`Remover`) |
| `pinTurma` | string? | **Smart PIN** da turma (portal do aluno): **2 dígitos** (novo) ou 6 díg (legado). Gerado no cadastro; **backfill** ao abrir turmas antigas |
| `instituicaoId` | string? | escola (ensino regular) a que a turma pertence |
| `ensinoRegular` | boolean? | marca a turma como de ensino regular (grade da instituição) |
| `nivelEnsino` | `'FUNDAMENTAL' \| 'MEDIO'`? | nível do ensino regular |
| `anoSerie` | string? | ano/série (ex.: `6º Ano`, `1ª Série`) |
| `gradeHoraria` | `{diaSemana, periodo}[]`? | horários da grade ocupados pela turma |

> Os 5 campos de config têm defaults aplicados no getter `TurmaEntity.configPontuacao`
> — turmas antigas sem os campos assumem `XP`/ativos.

> **Ensino regular:** quando `ensinoRegular` é `true`, a turma é `GRADE_FIXA`
> contínua e o backend **deriva `diasSemana`** dos dias distintos de `gradeHoraria`
> (o motor de projeção segue por dia da semana, sem alteração). Todos os campos
> são opcionais → nenhuma turma antiga muda.

### `instituicoes`
Escola do ensino regular. Guarda só os **parâmetros** da grade; os slots
(`1º Horário`, `Intervalo`, …) são **calculados** por `InstituicaoEntity.gerarGrade()`
e devolvidos na resposta como `grade` (não persistidos → sem drift).

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `professorId` | string | dono (uid) |
| `nome` | string | |
| `inicioPrimeiroPeriodo` | string | `'HH:mm'` |
| `fimUltimoPeriodo` | string | `'HH:mm'` |
| `duracaoAula` | number | minutos |
| `intervalos` | `{inicio, duracao}[]`? | intervalos/recreios (formato atual, **aceita mais de um**) |
| `inicioIntervalo` | string? | legado — intervalo único (`'HH:mm'`) |
| `duracaoIntervalo` | number? | legado — minutos do intervalo único |

Cada intervalo entra na **primeira fronteira de slot ≥ seu início** (após o
período que contém aquele horário). A geração para quando a próxima aula
ultrapassaria `fimUltimoPeriodo`; só os slots `AULA` recebem `periodo` (1..N).
`intervalosEfetivos()` usa a lista `intervalos` e cai no campo legado de
intervalo único quando ela não existe (sem quebrar instituições antigas).

### `sessoes`
A instância real de cada aula (o que aparece no calendário). Gerada pelo motor.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string | |
| `turmaId` / `professorId` | string | |
| `numero` | number | ordem da aula na turma (1..N) |
| `data` | string | `'YYYY-MM-DD'` |
| `status` | `'AGENDADA' \| 'CANCELADA' \| 'REALIZADA'` | |

### `excecoes`
Bloqueio pontual de uma data (feriado, imprevisto).

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `professorId` | string | |
| `data` | string | `'YYYY-MM-DD'` |
| `motivo` | string | |
| `escopo` | `'GLOBAL' \| 'ESCOLA' \| 'PESSOAL'` | |

### `ferias`
Bloqueio de um **intervalo** de datas.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `professorId` | string | |
| `turmaId` | string? | **ausente = global** (todas as turmas); presente = só aquela turma |
| `dataInicio` / `dataFim` | string | `'YYYY-MM-DD'` (inclusive) |
| `descricao` | string? | |

### `professores` (doc id = `uid`)
Perfil do professor.

| Campo | Tipo |
|---|---|
| `uid` | string |
| `nomeExibicao` | string? |
| `disciplina` | string? |
| `bio` | string? |
| `disciplinas` | string[]? (competências) |
| `username` | string? — handle público único (`@usuario`), **chave de busca do portal do aluno** |
| `lastUsernameChange` | string? (ISO) — última troca do handle; base da **trava de cooldown de 60 dias** |
| `avatarUrl` | string? — URL pública da foto de perfil (Firebase Storage; vazio = placeholder) |
| `planoAtual` | `'ESTAGIARIO' \| 'GRADUADO' \| 'MESTRE' \| 'PHD'` (default `ESTAGIARIO`) — plano **contratado** |
| `slotsAdicionaisComprados` | number (default `0`) — vagas avulsas somadas ao limite do plano |
| `statusAssinatura` | `'ATIVA' \| 'PENDENTE' \| 'INADIMPLENTE' \| 'CANCELADA'` (default `ATIVA`) — atualizado pelo webhook |
| `assinaturaAte` | string? (ISO) — vencimento da assinatura paga (hoje + 30d a cada pagamento). **Ausente = conta legada/mock ou tier grátis:** vigência presumida (não rebaixa) |
| `ultimoPagamentoEm` | string? (ISO) — data do último pagamento aprovado |
| `cortesiaAte` | string? (ISO) — cortesia por cupom (`MESES_GRATIS`); conta como vigência |
| `abacateCustomerId` | string? — id do cliente no gateway (Abacate Pay) |
| `billingIdAtual` | string? — id da última cobrança aberta (reconciliação/polling) |
| `aceiteTermosEm` | string? (ISO) — registro de consentimento dos Termos de Uso no cadastro (LGPD) |
| `aceitePrivacidadeEm` | string? (ISO) — registro de consentimento da Política de Privacidade no cadastro (LGPD) |
| `versaoDocumentosLegais` | string? — versão dos documentos legais aceita no cadastro (auditoria) |

### `alunos`
Lista de chamada de uma turma (não é conta do Firebase). Ganha PIN e XP para o portal.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `turmaId` | string | |
| `nome` | string | |
| `tagsPerfil` | string[]? | tags livres para dinâmicas |
| `pinAcesso` | string? | **Smart PIN** do aluno: **2 dígitos sequenciais** ('01', '02', …), único por turma (4 díg no legado) |
| `xpTotal` | number | pontuação materializada (soma dos `xp_logs`) |
| `equipeId` | string \| null? | equipe persistente do aluno; `null`/ausente = **sem equipe** (pool) |
| `cargoIds` | string[]? | cargos atribuídos ao aluno (relação **N↔N** com `cargos`) |
| `baseAteSessao` | number? | nº de aulas concluídas já recompensadas com **pontuação base** (idempotência) |

### `equipes`
Agrupamento **persistente** de alunos de uma turma (distinto do sorteio efêmero de squads).

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `turmaId` | string | |
| `titulo` | string | |
| `descricao` | string? | |
| `cor` | string | destaque (`#RRGGBB`) |
| `criadoEm` | string | `'YYYY-MM-DD'` |

### `cargos`
Tarefas/papéis atribuíveis aos membros das equipes (ex.: "Líder", "Redator").

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `turmaId` | string | |
| `nome` | string | cadastrado **em lote**; o vínculo com alunos vive em `alunos.cargoIds` |

### `planos_aula`
Escopo geral (Syllabus) de uma disciplina — um por `(professor, disciplina)`.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `professorId` | string | |
| `disciplina` | string | |
| `contextoGeral` | string | texto macro (objetivos, ementa, bibliografia) |

### `topicos`
Backlog de tópicos de uma disciplina (microplanejamento, Graduado+).

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `professorId` | string | |
| `disciplina` | string | |
| `nome` | string | cadastrado em lote |

### `alocacoes`
Vínculo tópico↔aula, ancorado no **número da aula** (não na data).

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `turmaId` | string | |
| `numeroAula` | number | ancora a alocação — sobrevive ao deslizamento da grade |
| `topicoId` | string | |

### `xp_logs`
Registro (event sourcing) de cada distribuição de pontos.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `alunoId` / `turmaId` | string | |
| `pontos` | number | delta aplicado (pode ser negativo) |
| `motivo` | string? | `BASE` (aula concluída), `QLICK` (partida) ou livre (pontuação manual) |
| `data` | string | ISO datetime |

### `qlicks`
Um quiz do professor (template reutilizável). **PhD-exclusivo**.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `professorId` | string | |
| `titulo` | string | |
| `disciplina` | string? | **turma OU disciplina é obrigatória** na criação (400 `TURMA_OU_DISCIPLINA`) |
| `topicoId` | string? | vínculo opcional com um tópico do plano de aula |
| `numeroAula` | number? | aula (1..N) fixada manualmente quando não há tópicos — controla a visibilidade no painel |
| `turmaId` | string? | **legado** — turma única (mantido; unificado por `turmas`) |
| `turmaIds` | string[]? | turmas atribuídas ao Qlick (**N:N**) |
| `duracaoSegundos` | number | tempo por pergunta (default `60`) |
| `perguntas` | `{ enunciado, alternativas: string[], corretaIndex }[]` | `corretaIndex` **nunca** é exposto ao cliente |

> `wor_jogos` e `isolateus_jogos` espelham os mesmos campos de vínculo
> (`disciplina`/`topicoId`/`numeroAula`/`turmaId`/`turmaIds`) e a mesma regra
> **turma OU disciplina**. Jogo **só com disciplina** (sem `turmaIds`) fica
> disponível para todas as turmas daquela disciplina — a criação de partida aceita
> uma turma que case por disciplina.

### `qlick_partidas`
Estado **em tempo real** de uma rodada ao vivo — a **única** coleção lida pelo cliente
(via `onSnapshot`). Escrita só pelo Admin SDK.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `qlickId` / `professorId` | string | |
| `turmaId` | string? | herdado do Qlick |
| `titulo` | string | |
| `status` | `'LOBBY' \| 'QUESTAO_ATIVA' \| 'RANKING_PARCIAL' \| 'ENCERRADO'` | máquina de estados |
| `perguntaAtual` / `totalPerguntas` | number | índice corrente (−1 no lobby) |
| `duracaoSegundos` | number | janela da pergunta |
| `perguntaIniciadaEm` | string? | ISO; base do timer do cliente |
| `perguntaPublica` | `{ enunciado, alternativas }?` | **sem** a resposta correta |
| `corretaIndex` | number? | revelado **só** no `RANKING_PARCIAL` |
| `inscritos` | `{ alunoId, nome }[]` | congelado ao iniciar |
| `placar` | `{ alunoId, nome, pontos }[]` | acumulado ordenado |
| `rankingParcial` | `PlacarItem[]?` | top da rodada |
| `rankingFinal` | `({ posicao } & PlacarItem)[]?` | pódio no encerramento |

### `qlick_respostas`
Respostas cruas dos alunos — **server-only** (o cliente nunca lê; ficaria de fora das rules).
Doc id determinístico `${partidaId}_${perguntaIndex}_${alunoId}` garante **1 resposta por
aluno/pergunta** (idempotência).

| Campo | Tipo | Observação |
|---|---|---|
| `partidaId` / `alunoId` | string | |
| `perguntaIndex` | number | filtrado em memória (evita índice composto) |
| `alternativaIndex` | number | escolha do aluno |
| `correta` | boolean | |
| `pontos` | number | acerto: `1000` + bônus de rapidez (até `500`) |

### `prompts_ia` (doc id = jogo)
Governança dos prompts de IA (BUG-ENH-006). **Server-only**, editável pelo admin —
sem doc, o serviço usa o template default embutido no código (a coleção pode nascer vazia).

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `jogo` | `'qlick' \| 'wor' \| 'isolateus'` | o doc id **é** o jogo |
| `template` | string | prompt com tokens (`{contexto}`, `{instrucao}`, `{qtdPerguntas}`…) |
| `atualizadoEm` | string? | ISO |

### `config/ia`
Configuração global da IA. Hoje guarda só o **limite de gerações por dia por jogo**
(default `1`). O contador diário por professor/jogo vive em `professores/{uid}`
(`worIaUsos`/`qlickIaUsos`/`isolateusIaUsos` = `{ dia, n }`).

| Campo | Tipo | Observação |
|---|---|---|
| `limiteGeracoesDia` | number | `1..20`; enforcement nos `*IaService` (devolvem `restantes`) |
| `atualizadoEm` | string? | ISO |

### `feedbacks`
Relatos enviados pelos professores (bug, sugestão, dúvida, elogio) e a triagem do admin.

**Server-only.** Ao contrário das partidas dos jogos, esta coleção **não** é lida em tempo real
pelo cliente: ela carrega e-mail, nome, User-Agent e o texto de todo professor. Como o front
**não tem sessão do Firebase Auth** (o login é `POST /auth/login` no Nest; o SDK do Firebase no
cliente serve só a Firestore/Storage), `request.auth` é sempre `null` nas rules — só existiria
`if true` (público) ou `if false`. Um `onSnapshot` aqui publicaria a base de reclamações para
quem abrisse o DevTools. Fica no deny-all, e a inbox do admin consome por REST.

| Campo | Tipo | Observação |
|---|---|---|
| `professorId` / `professorNome` / `professorEmail` | string | **vêm do token**, nunca do corpo (identidade do cliente é spoofável); nome do `professores/{uid}`, e-mail do Firebase Auth |
| `categoria` | `'BUG' \| 'SUGESTAO' \| 'DUVIDA' \| 'ELOGIO'` | rótulo humano ("Relato de Bug") só na exibição |
| `mensagem` | string | gravada **como o professor digitou** — o escape acontece na fronteira do HTML do e-mail, não aqui |
| `rota` | string | `router.url` do Angular no clique (não o `Referer`, que num SPA aponta para onde a aba abriu) |
| `userAgent` | string | navegador/aparelho, para reproduzir o bug |
| `status` | `'PENDENTE' \| 'EM_ANALISE' \| 'RESOLVIDO'` | nasce sempre `PENDENTE` |
| `criadoEm` | string ISO | relógio do **servidor** |
| `notaInterna` | string? | anotação do admin, invisível para o professor |
| `atualizadoEm` | string? | última triagem |
| `notificadoEm` | string? | quando o alerta saiu. **Ausente = o e-mail não foi enviado** — a inbox mostra isso, senão a falha morreria no log |

### `cobrancas` (doc id = id da cobrança no gateway)
Intenção de compra registrada no checkout. **Server-only** (o cliente nunca lê; o status vem por
`GET /checkout/status/:id`). É a **fonte da idempotência**: o webhook credita a partir deste doc,
não do payload, e marca `PAID` numa transação — um segundo evento para o mesmo id não credita de novo.

| Campo | Tipo | Observação |
|---|---|---|
| `professorId` | string | dono da cobrança |
| `tipo` | `'UPGRADE' \| 'SLOT'` | UPGRADE concede plano; SLOT concede uma vaga avulsa |
| `planoAlvo` | `PlanoAtual?` | plano a conceder (só UPGRADE) |
| `valorCentavos` | number | valor cobrado |
| `metodo` | `'PIX' \| 'CARTAO'` | PIX inline ou checkout hospedado |
| `cupom` | string? | código de desconto aplicado na cobrança |
| `status` | `'PENDING' \| 'PAID' \| 'EXPIRED' \| 'CANCELLED' \| 'REFUNDED'` | nasce `PENDING` |
| `criadoEm` / `pagoEm` | string ISO | criação e aprovação |

---

## Endpoints

Todas as rotas exigem `Authorization: Bearer <idToken>`, exceto as marcadas
**pública**. `professorId` vem sempre do token.

### Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/auth/login` **(pública)** | `{ email, password }` | `{ token, expiresIn, uid, email }` + **`Set-Cookie: tichr_rt`** (`HttpOnly`). O `refreshToken` **não** vem no corpo — ver [Autenticação](#autenticação) |
| `POST` | `/auth/signup` **(pública)** | `{ nome, email, password, aceiteTermos, aceitePrivacidade }` | `{ token, … }` + cookie — **cadastro**: exige o **aceite** dos Termos de Uso e da Política de Privacidade (validado no DTO e no service; 400 sem aceite); cria a conta no Identity Toolkit e provisiona `professores/{uid}` (plano ESTAGIARIO) com `nomeExibicao` + **registro de consentimento LGPD** (`aceiteTermosEm`, `aceitePrivacidadeEm`, `versaoDocumentosLegais`); dispara o e-mail de confirmação (*best-effort*) e já devolve o token (409 `EMAIL_EM_USO`) |
| `POST` | `/auth/refresh` **(pública)** | — (o refresh vem do **cookie**) | `{ token, expiresIn, uid, email }` + cookie reemitido se rotacionou. `401 { code: 'SESSAO_EXPIRADA' }` sem cookie, expirado ou revogado (troca de senha/e-mail revoga) |
| `POST` | `/auth/logout` **(pública)** | — | `{ ok: true }` — apaga o cookie; o front não apaga um `HttpOnly` sozinho |
| `POST` | `/auth/recuperar-senha` **(pública)** | `{ email }` | **Sempre** `200 { enviado: true }` — inclusive para e-mail inexistente ou provedor fora do ar. Resposta indistinguível de propósito: distinguir revelaria quem tem conta no Tichr (anti-enumeração) |
| `GET` | `/auth/verificacao` **(`@SemVerificacao`)** | — | `{ verificado: boolean }` — lido **ao vivo** no Firebase Auth; o claim do ID token fica congelado na emissão e não serve para o *poll* da tela de espera |
| `POST` | `/auth/verificacao/reenviar` **(`@SemVerificacao`)** | — | `{ enviado: true }` — reenvia a confirmação. `429 { code: 'VERIFICACAO_COOLDOWN' }` no *throttle* do Identity Toolkit |
| `GET` | `/auth/conta` | — | `{ email, emailVerificado }` — e-mail atual da conta (vive só no Auth, não no Firestore). Endpoint dedicado da página de Segurança |
| `POST` | `/auth/email` | `{ novoEmail, senha }` | `{ enviado: true, novoEmail }` — reautentica com a senha atual e dispara `VERIFY_AND_CHANGE_EMAIL`: **o e-mail só troca quando o link chega na caixa nova**; o antigo vale até lá. `401 { code: 'SENHA_INVALIDA' }`, `409 { code: 'EMAIL_EM_USO' }`. Ao confirmar, o Firebase revoga a sessão |
| `POST` | `/auth/aluno` **(pública)** | `{ turmaId, pin }` | `{ token, aluno, turma: { nomePontuacao, rankingAtivo, niveis } }` — JWT de aluno + config da turma (`niveis` = limiares de patente, para o badge do aluno bater com o que o professor configurou) |
| `GET` | `/auth/turma/:turmaId` **(pública)** | — | `{ turmaId, turmaNome, alunos: [{ id, nome }], config, pinAlunoLength }` — info da tela de login do aluno (`pinAlunoLength` = quantos slots de PIN exibir) |
| `GET` | `/` **(pública)** | — | health check |

### Backoffice — Admin (`AdminGuard`)
Todas exigem que **`professores/{uid}.isAdmin === true`** no Firestore (fonte de verdade), verificado pelo `AdminGuard` (leitura por chamada, só nas rotas `/admin/*`).

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/admin/ping` | — | `{ admin: true }` — sonda usada pelo guard do front |
| `GET` | `/admin/metrics` | — | `{ totalProfessores, ativos, desativados, porPlano }` |
| `GET` | `/admin/usuarios?busca=` | — | `UsuarioAdminView[]` — professores + uso (`turmasAtivas`, `alunos`, `qlicks`); filtra por nome/username/e-mail |
| `GET` | `/admin/usuarios/:uid` | — | `UsuarioAdminView` |
| `POST` | `/admin/usuarios/:uid/reset-senha` | — | dispara e-mail de redefinição (Identity Toolkit `sendOobCode`) |
| `POST` | `/admin/usuarios/:uid/limpar-dados` | — | apaga turmas/alunos/qlicks do professor (mantém o login) |
| `DELETE` | `/admin/usuarios/:uid?hard=` | — | `soft` (flag `desativadoEm`) ou `hard` (dados + `deleteUser` no Auth) |
| `PATCH` | `/admin/usuarios/:uid/plano` | `{ plano }` | override manual de plano (sem cobrança) |
| `POST` | `/admin/usuarios/:uid/admin` | `{ conceder }` | concede/revoga admin gravando `professores/{uid}.isAdmin` (vale na hora, sem re-login) |
| `GET` | `/admin/feedbacks` | — | `FeedbackEntity[]`, mais novos primeiro. **REST, não `onSnapshot`** — ver [`feedbacks`](#feedbacks) |
| `PATCH` | `/admin/feedbacks/:id` | `{ status?, notaInterna? }` | triagem. Ambos opcionais: **o que não vem não é tocado** (mudar o status não apaga a nota). `404` se o id não existe |
| `GET` | `/admin/ia/prompts` | — | `PromptIaView[]` — os 3 jogos com template vigente + o default |
| `GET` | `/admin/ia/prompts/:jogo` | — | `PromptIaView` |
| `PUT` | `/admin/ia/prompts/:jogo` | `{ template }` | grava o override do prompt (≥20 chars) |
| `DELETE` | `/admin/ia/prompts/:jogo` | — | remove o override → volta ao template default |
| `GET` | `/admin/ia/config` | — | `{ limiteGeracoesDia, atualizadoEm? }` |
| `PATCH` | `/admin/ia/config` | `{ limiteGeracoesDia }` | ajusta o limite global (`1..20`), reflete na hora |

### Feedback
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/feedbacks` | `{ categoria, mensagem, rota, userAgent }` | `FeedbackEntity` (`201`). O corpo tem **só** esses quatro campos: identidade e *timestamp* saem do token/servidor, e o `ValidationPipe` (`forbidNonWhitelisted`) devolve `400` para qualquer extra — inclusive um `professorId` forjado. Grava e **responde sem esperar o e-mail**; o alerta sai depois, e a falha dele vira `notificadoEm` ausente + log |

### Cupons
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/admin/cupons` **(admin)** | — | `CupomEntity[]` |
| `POST` | `/admin/cupons` **(admin)** | `CreateCupomDto` | cria cupom (`PLANO_GRATIS`/`MESES_GRATIS`, + `discountKind`/`discount?`). **Espelha no gateway** (`coupon.create`, guarda `abacateCupomId`) — best-effort: sem chave/falha, o cupom local ainda nasce |
| `PATCH` | `/admin/cupons/:id` **(admin)** | `UpdateCupomDto` | ativa/desativa, ajusta limite |
| `DELETE` | `/admin/cupons/:id` **(admin)** | — | remove |
| `POST` | `/checkout/cupom` (professor) | `{ codigo }` | aplica o cupom ao próprio perfil (transação: revalida limite + incrementa `usos`) |

### Turmas
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/turmas` | `CreateTurmaDto` | `{ turma, sessoes }` — barrado pelo **`PlanosGuard`** (403 `LIMIT_REACHED`); 400 `LIMITE_TURMAS` no teto estrutural de **99 ativas** |
| `GET` | `/turmas` | — | `TurmaEntity[]` |
| `GET` | `/turmas/:id` | — | `TurmaEntity` (404 se não for do professor). **Backfill** do `pinTurma` (2 díg) se ausente |
| `GET` | `/turmas/:id/progresso` | — | `{ concluidas, total, pct, pontuacaoBase }` — evolução do curso + **base coletiva** (`concluidas × 10`) |
| `POST` | `/turmas/:id/migrar-pins` | — | `{ turma, alunos }` — migra a turma para **Smart PINs**: regenera o PIN da sala (2 díg) e redistribui os PINs dos alunos ('01', '02', …) |
| `POST` | `/turmas/:id/encerrar` | — | `TurmaEntity` — encerra a turma (**somente-leitura**; sai do pool de PINs e vai para o Hall da Fama) |
| `PUT` | `/turmas/:id` | `UpdateTurmaDto` | `{ turma, sessoes }` — **reprojeta**; aceita `encerradaManualmente` |

`CreateTurmaDto`: `nome`, `tipoModalidade`, `diasSemana[]`, `dataInicio`,
`totalAulas?` (obrigatório se módulo), `cor?` (`#RRGGBB`), `disciplina?`,
`horaInicio?`/`horaFim?` (`HH:mm`), a **config de pontuação** `pontuacaoAtiva?`,
`nomePontuacao?`, `rankingAtivo?`, `rotuloAdicionar?`, `rotuloRemover?`, e os campos
de **ensino regular** `instituicaoId?`, `ensinoRegular?`, `nivelEnsino?`,
`anoSerie?`, `gradeHoraria?` (`{diaSemana, periodo}[]`). `UpdateTurmaDto` = os
mesmos, todos opcionais, + `encerradaManualmente?`.

### Instituições (ensino regular)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/instituicoes` | — | `InstituicaoView[]` (cada uma com a `grade` calculada) |
| `GET` | `/instituicoes/:id` | — | `InstituicaoView` (404 se não for do professor) |
| `POST` | `/instituicoes` | `CreateInstituicaoDto` | `InstituicaoView` |
| `PUT` | `/instituicoes/:id` | `UpdateInstituicaoDto` | `InstituicaoView` |
| `DELETE` | `/instituicoes/:id` | — | `204` |

`CreateInstituicaoDto`: `nome`, `inicioPrimeiroPeriodo`/`fimUltimoPeriodo` (`HH:mm`),
`duracaoAula` (min), `inicioIntervalo?` (`HH:mm`), `duracaoIntervalo?` (min,
obrigatório se houver intervalo). `InstituicaoView` = a entidade + `grade`
(`{ordem, tipo, periodo?, rotulo, horaInicio, horaFim}[]`).

### Checkout / pagamentos (Abacate Pay)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/checkout/upgrade` | `{ plano, metodo, cupom? }` | cria cobrança e devolve `{ billingId, metodo, status, valorCentavos, brCode?, brCodeBase64?, expiraEm?, url? }` — **não** muda o plano. Admin/destino gratuito: `{ concedido: true }` |
| `POST` | `/checkout/slot-avulso` | `{ metodo }` | cria cobrança da vaga avulsa (mesma forma). Admin: `{ concedido: true }` |
| `GET` | `/checkout/status/:billingId` | — | `{ status }` — reconcilia com o gateway; concede se já pago (idempotente) |
| `POST` | `/checkout/simular/:billingId` | — | `{ status: 'PAID' }` — **só em devMode** (403 fora dele) |
| `POST` | `/checkout/webhook` **(público)** | evento do gateway | `{ ok: true }` — segredo na query (`?webhookSecret=`) + HMAC-SHA256 opcional; concede numa transação idempotente |
| `POST` | `/checkout/cupom` (professor) | `{ codigo }` | aplica cupom de cortesia ao próprio perfil (concede sem pagamento) |

> **Concessão só via webhook** (padrão SaaS): o plano/slot só é creditado quando o
> `billing.paid` chega. PIX é inline (QR + copia-e-cola); cartão redireciona para o checkout
> hospedado. Recorrência é **PIX one-time mensal** (`assinaturaAte` = hoje+30d por pagamento);
> vencer sem renovar rebaixa o **plano efetivo** para ESTAGIARIO na interface, **sem apagar dados**.
> Admin é **isento** de cobrança. O `AbacatePayService` fala a **REST v2** direto (`fetch`, molde do
> `GeminiService`) — o SDK oficial `@abacatepay/sdk` foi avaliado mas envia o corpo do PIX no formato
> errado (422 contra a API ao vivo), então não é usado. Validado em devMode (create → simulate → paid).

### Alunos e gamificação
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/turmas/:turmaId/alunos` | — | `AlunoEntity[]` |
| `POST` | `/turmas/:turmaId/alunos` | `{ nomes: string[] }` | `AlunoEntity[]` — cadastro **em lote** (gera PIN/turma). **403 `PLANO_LOCKED`** se `< MESTRE` |
| `PATCH` | `/turmas/:turmaId/alunos/:alunoId` | `{ nome }` | `AlunoEntity` — **renomeia** o aluno. **403 `PLANO_LOCKED`** se `< MESTRE` |
| `DELETE` | `/turmas/:turmaId/alunos/:alunoId` | — | `{ removido: true }` |
| `PATCH` | `/turmas/:turmaId/alunos/:alunoId/equipe` | `{ equipeId: string \| null }` | `AlunoEntity` — move o aluno para uma equipe (drop) ou de volta ao pool (`null`) |
| `POST` | `/turmas/:turmaId/alunos/:alunoId/xp` | `{ pontos, motivo? }` | `{ alunoId, xpTotal }` — grava log + atualiza total. **403 `GAMIFICACAO_LOCKED`** se não-PhD; **400** se `pontuacaoAtiva=false` |
| `POST` | `/turmas/:turmaId/agrupamento` | `{ numeroEquipes, papeis?, temas? }` | `{ squads }` — sorteio efêmero |
| `GET` | `/turmas/:turmaId/ranking` | — | `[{ posicao, alunoId, nome, xpTotal }]` (professor **ou** aluno da turma). **403** se `rankingAtivo=false` |

### Equipes (agrupamento persistente)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/turmas/:turmaId/equipes` | — | `EquipeEntity[]` |
| `POST` | `/turmas/:turmaId/equipes` | `{ titulo, descricao?, cor }` | `EquipeEntity` |
| `PUT` | `/turmas/:turmaId/equipes/:equipeId` | `{ titulo?, descricao?, cor? }` | `EquipeEntity` |
| `DELETE` | `/turmas/:turmaId/equipes/:equipeId` | — | `{ removido: true }` — devolve os alunos ao **pool** (`equipeId → null`) |
| `POST` | `/turmas/:turmaId/equipes/distribuir` | — | `AlunoEntity[]` — distribui os alunos pelas equipes de forma **balanceada** (Fisher-Yates + round-robin). **400** se não houver equipes |

### Cargos (papéis atribuíveis aos membros)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/turmas/:turmaId/cargos` | — | `CargoEntity[]` |
| `POST` | `/turmas/:turmaId/cargos` | `{ nomes: string[] }` | `CargoEntity[]` — cadastro **em lote** |
| `DELETE` | `/turmas/:turmaId/cargos/:cargoId` | — | `{ removido: true }` — desatribui o cargo de todos os alunos |
| `PUT` | `/turmas/:turmaId/cargos/:cargoId/membros` | `{ alunoIds: string[] }` | `AlunoEntity[]` — define o **conjunto final** de responsáveis (**N↔N**, idempotente) |

### Portal — jornada pública de acesso do aluno
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/portal/professor/:username/turmas` **(pública)** | — | `{ professor: { nome, username, avatarUrl? }, turmas: [{ turmaId, nome, cor, pinLength }] }` — professor (com **avatar**) + só turmas **ativas** (`pinLength` = 2 Smart / 6 legado) |
| `POST` | `/portal/turma/:turmaId/alunos` **(pública)** | `{ pinTurma }` | valida o **PIN (2–6 díg)** → `{ turmaId, turmaNome, alunos:[{id,nome}], config, pinAlunoLength }` (nomes só após o PIN) |
| `GET` | `/portal/professor/:username/hall` **(pública)** | — | `{ professor, turmas }` — **Hall da Fama**: só as turmas **encerradas** |
| `GET` | `/portal/turma/:turmaId/hall` **(pública)** | — | `{ turmaId, turmaNome, nomePontuacao, alunos, ranking }` — mural público (ranking final), **sem PIN**; turma ainda ativa → 404 |

### Portal do aluno (`@Roles('STUDENT')`)
| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/aluno/me` | `AlunoEntity` — perfil do próprio aluno (sincroniza a **base passiva** antes) |
| `GET` | `/aluno/agenda` | `SessaoAulaEntity[]` — sessões (já recalculadas) da própria turma |
| `GET` | `/aluno/progresso` | `{ concluidas, total, pct, pontuacaoBase }` — evolução do curso |
| `GET` | `/aluno/plano` | `{ topicos: [{ numeroAula, topico }] }` — tópicos alocados às aulas (só se o professor é **PhD**) |

### Plano de Aula
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/planos-aula` | — | `PlanoAulaEntity[]` (403 `PLANO_LOCKED` se `< GRADUADO`) |
| `PUT` | `/planos-aula` | `{ disciplina, contextoGeral }` | `PlanoAulaEntity` — upsert do escopo geral por disciplina |
| `GET` | `/topicos?disciplina=` | — | `TopicoEntity[]` (403 `PLANO_LOCKED` se `< GRADUADO`) |
| `POST` | `/topicos` | `{ disciplina, nomes: string[] }` | `TopicoEntity[]` — lote |
| `DELETE` | `/topicos/:id` | — | `{ removido: true }` — limpa as alocações do tópico |
| `GET` | `/turmas/:turmaId/alocacoes` | — | `AlocacaoEntity[]` |
| `PUT` | `/turmas/:turmaId/alocacoes/:numero` | `{ topicoId: string \| null }` | aloca (upsert por número) ou desaloca (`null`) |

### Tichr Qlick (professor — comandos REST)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/qlicks` | — | `QlickEntity[]` (403 `QLICK_LOCKED` se não-PhD) |
| `POST` | `/qlicks` | `CreateQlickDto` | `QlickEntity` — valida `corretaIndex` no intervalo |
| `GET` | `/qlicks/:id` | — | `QlickEntity` |
| `PUT` | `/qlicks/:id` | `CreateQlickDto` | `QlickEntity` |
| `DELETE` | `/qlicks/:id` | — | `{ removido: true }` |
| `PUT` | `/qlicks/:id/turmas` | `{ turmaIds: string[] }` | atribui (substitui) as turmas do Qlick — relação **N:N** |
| `POST` | `/qlicks/:qlickId/partida` | `{ turmaId? }` | `PartidaEntity` em `LOBBY` — a partida **escolhe a turma** (N:N); 400 `TURMA_NAO_ATRIBUIDA`/`TURMA_ENCERRADA` |
| `GET` | `/partidas/:id` | — | `PartidaEntity` (dona do professor) |
| `POST` | `/partidas/:id/iniciar` | — | congela inscritos, ativa a pergunta 1 (400 se sem inscritos) |
| `POST` | `/partidas/:id/apurar` | — | revela a resposta e o ranking da rodada |
| `POST` | `/partidas/:id/proxima` | — | avança (400 se ainda não apurou ou se era a última) |
| `POST` | `/partidas/:id/encerrar` | — | monta o pódio e **credita o XP** (400 se já encerrada) |

### Tichr Qlick (aluno — `@Roles('STUDENT')`)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/aluno/qlick` | — | `{ partidaId, titulo, status } \| null` — partida "de hoje" da turma, dentro da janela da aula |
| `POST` | `/aluno/qlick/:partidaId/inscricao` | — | `PartidaEntity` — entra no lobby (idempotente; 400 fora do `LOBBY`) |
| `POST` | `/aluno/qlick/:partidaId/resposta` | `{ alternativaIndex }` | `{ registrada }` — grava a resposta; **auto-apura** quando todos respondem |

### Sessões
| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/sessoes` | `SessaoAulaEntity[]` (todas as sessões do professor) |

### Exceções
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/excecoes` | `{ data, motivo, escopo }` | `{ excecao, turmasRecalculadas }` — dispara recálculo |

### Férias
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/ferias` | — | `FeriasEntity[]` |
| `POST` | `/ferias` | `{ turmaId?, dataInicio, dataFim, descricao? }` | `{ ferias, turmasRecalculadas }` |
| `DELETE` | `/ferias/:id` | — | `{ turmasRecalculadas }` |

### Perfil
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/profile` | — | `ProfessorView` — campos do perfil + derivados `podeAlterarUsername` / `diasParaTrocarUsername` (perfil vazio só com `uid` se ainda não existe — 200, não 404) |
| `GET` | `/profile/check-username?u=` | — | `{ username, disponivel }` — disponibilidade do handle (debounce da UI) |
| `PUT` | `/profile` | `{ nomeExibicao?, username?, disciplina?, bio?, disciplinas?[], avatarUrl? }` | `ProfessorView` (upsert; `username` normalizado e **único** → 409 se em uso; troca do handle **trava 60 dias** → 409 `{ code: 'USERNAME_COOLDOWN', diasRestantes }`) |

### Home (BFF — agregador do painel)
| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/home` | `{ profile: ProfessorView, turmas: TurmaEntity[] }` — perfil + turmas num **único roundtrip** (`Promise.all` no servidor, fim do efeito cascata) |

---

## Regras de negócio

O coração do sistema é o **Motor de Agendamento** (`TurmaEntity.projetarSessoes`), uma
função **pura** e testada (Jest) que recebe a data de início, os dias da semana e o
conjunto de **datas bloqueadas**, e devolve o array de sessões.

### Modalidades

**`MODULO_FECHADO` — deslizamento.** Curso com número fixo de encontros (`totalAulas`).
O motor caminha dia a dia gerando aulas nos `diasSemana`; ao cair numa data bloqueada,
**a aula não é gerada e desliza** para a próxima data válida, empurrando todas as
seguintes. Gera exatamente `totalAulas` sessões `AGENDADA`; a `dataFimPrevista` é a data
da última aula (recalculada automaticamente a cada bloqueio).

**`GRADE_FIXA` — rígido.** Grade contínua (escola pública). O motor projeta as aulas até
um horizonte (~120 dias). A aula que cai numa data bloqueada é marcada **`CANCELADA`**
(não desliza) — o cronograma das demais não muda.

### Datas bloqueadas (escopo)

Para projetar uma turma, o service monta o conjunto de datas bloqueadas em
`carregarBloqueador(professorId)`:

```
bloqueadas(turma) = exceções(professor)
                  ∪ férias globais(professor)
                  ∪ férias da própria turma
```

- **Exceções** são pontuais e sempre globais ao professor.
- **Férias** são intervalos (expandidos para o conjunto de dias). Uma férias **global**
  afeta todas as turmas; uma férias **com `turmaId`** afeta só aquela turma.

### Recálculo (reprojeção)

Qualquer mudança que afete a projeção regenera as sessões da(s) turma(s) — apaga as
antigas, reprojeta com o calendário atual e regrava (`reprojetar`):

- **Criar turma** → projeta e persiste as sessões.
- **Editar turma** (`PUT /turmas/:id`) → reprojeta aquela turma.
- **Adicionar exceção** → recalcula todas as turmas ativas do professor.
- **Adicionar / remover férias** → recalcula todas as turmas ativas.

Trocar de `MODULO_FECHADO` para `GRADE_FIXA` numa edição limpa a `dataFimPrevista`.
As sessões da reprojeção são persistidas em paralelo para acelerar a operação.

### Exemplo de deslizamento (módulo)

Módulo de 5 aulas às segundas a partir de `2026-03-02`, com um feriado em `2026-03-16`:

```
sem exceção:  02/03 · 09/03 · 16/03 · 23/03 · 30/03   (fim: 30/03)
com feriado:  02/03 · 09/03 · ▓▓▓▓ · 23/03 · 30/03 · 06/04   (fim recalculado: 06/04)
                              a aula 3 desliza; as seguintes acompanham
```

### Planos e cota de turmas

Cada plano tem um **limite base** de turmas ativas simultâneas, somado às vagas avulsas:

| Plano | Limite base |
|---|---|
| `ESTAGIARIO` | 5 |
| `GRADUADO` / `MESTRE` / `PHD` | 99 |

Nenhum plano é ilimitado: o **teto técnico é 99** porque o PIN da turma é de **2 dígitos**
(`01`–`99`) e não pode repetir entre turmas ativas (`LIMITE_TURMAS_ATIVAS`). `LIMITE_BASE_PLANO`
dos pagos referencia esse pool, e `ProfessorEntity.limiteTurmas` faz
`min(base + slots, 99)`.

`limite = min(base(plano) + slotsAdicionaisComprados, 99)`. Uma turma **ocupa cota**
(`TurmaEntity.contaComoAtiva`) quando **não** foi encerrada manualmente **e** seu
cronograma ainda está vigente — módulos deixam de contar quando a `dataFimPrevista`
passa; grades fixas contam sempre. Ao criar turma, o **`PlanosGuard`** compara
`contarTurmasAtivas` com o limite e lança **403 `LIMIT_REACHED`** se estourar. O professor
libera espaço comprando um slot avulso, fazendo upgrade ou arquivando uma turma
(`encerradaManualmente`).

### Orquestração de grupos (squads)

O `AgrupamentoService` é uma função **pura** (testada em Jest) que recebe a lista de
alunos, o número de equipes, os papéis e os temas:

1. **Embaralha** os alunos com **Fisher-Yates**.
2. **Distribui** em N equipes de tamanho similar (round-robin — diferença de no máximo 1).
3. **Atribui papéis** sequencialmente dentro de cada equipe (`papeis[i % papeis.length]`).
4. **Sorteia um tema** por equipe (quando há temas).

### Equipes, distribuição e cargos

As **equipes** são um agrupamento **persistente** (coleção `equipes`), diferente do
sorteio efêmero de squads. O vínculo aluno↔equipe vive em `alunos.equipeId`
(`null` = pool "sem equipe"); um aluno pertence a **no máximo uma** equipe.

- **Atribuição manual** (`PATCH …/alunos/:id/equipe`): valida a posse da turma e da equipe
  de destino; `null` devolve o aluno ao pool.
- **Distribuição balanceada** (`POST …/equipes/distribuir`): embaralha (Fisher-Yates) e
  distribui round-robin pelas equipes existentes, persistindo o `equipeId` de cada aluno.
- **Excluir equipe** devolve os alunos ao pool (`AlunoRepository.limparEquipe`), nunca os
  apaga.

Os **cargos** (coleção `cargos`) são papéis atribuíveis aos membros — relação **N↔N** via
`alunos.cargoIds`: um membro pode ter vários cargos e um cargo pode ser dividido entre
vários membros. A atribuição (`PUT …/cargos/:cargoId/membros`) recebe o **conjunto final**
de `alunoIds` e é **idempotente**: para cada aluno da turma, garante o `cargoId` presente
**sse** estiver no conjunto (adiciona/remove em lote; reenviar o mesmo conjunto não
escreve nada). Excluir um cargo o remove de todos os alunos (`limparCargo`).

### Gamificação (XP, ranking e config)

A pontuação é **configurável por turma** (getter `TurmaEntity.configPontuacao`, com
defaults): `pontuacaoAtiva`, `nomePontuacao` (ex.: "XP", "Aura"), `rankingAtivo` e os
rótulos `rotuloAdicionar`/`rotuloRemover`.

- **Distribuição de XP** (`XpService.distribuir`): grava um evento em `xp_logs` **e**
  atualiza o `xpTotal` do aluno numa **transação do Firestore** (mantém log e total
  coerentes). O total nunca fica negativo. Retorna **400** se a turma tem
  `pontuacaoAtiva=false`.
- **Ranking** (`GET /turmas/:turmaId/ranking`): alunos ordenados por `xpTotal`
  decrescente, com o posicionamento. Acessível pelo professor dono e pelos alunos da
  própria turma (um aluno não vê o ranking de outra turma). Retorna **403** se a turma tem
  `rankingAtivo=false`.
- A config pública (`nomePontuacao`, `rankingAtivo`, `niveis`) viaja ao **portal do aluno**
  no login (`POST /auth/aluno`) e no `GET /auth/turma/:turmaId`, para o front rotular sem
  hardcode. `niveis` são os **limiares de patente da turma** (`{ prata, ouro, diamante,
  platina }`, de `TurmaEntity.configPontuacao`, já normalizados/ascendentes): sem eles o
  painel do aluno cairia nos defaults e exibiria uma patente diferente da que o professor
  configurou. A fonte de verdade continua sendo **só** o doc da turma.
- **Exclusividade PhD** (`ProfessorEntity.podeGamificar`): distribuir XP exige
  `planoAtual === 'PHD'` — senão **403 `GAMIFICACAO_LOCKED`**. O front trava a UI de
  pontuação e o toggle do portal nos planos inferiores, com upsell.
- **Pontuação base passiva** (`XpService.sincronizarBaseTurma`): cada aula **concluída**
  (data no passado) rende `BASE_POR_AULA = 10` pontos de base a todos os alunos. É
  **idempotente** — `aluno.baseAteSessao` guarda quantas aulas concluídas já renderam base,
  então reprocessar não duplica. Disparada de forma preguiçosa ao listar alunos, rankear ou
  o aluno carregar o perfil. A **base coletiva** exposta em `/turmas/:id/progresso` e
  `/aluno/progresso` é `concluidas × 10`.

### Portal do aluno: `@username` + PIN da turma

O aluno acessa o portal sem e-mail, por uma jornada pública em camadas:

1. **Busca** pelo `@username` do professor → `GET /portal/professor/:username/turmas`
   devolve apenas as turmas **ativas** (omite encerradas/expiradas).
2. **PIN da turma** (2 díg Smart / 6 díg legado) → `POST /portal/turma/:turmaId/alunos` só devolve
   os **nomes** após validar o PIN — isolamento entre turmas.
3. **PIN do aluno** (2 díg Smart / 4 díg legado) → `POST /auth/aluno` emite o JWT de aluno.

O `username` é único e normalizado (sem `@`, minúsculo); `GET /profile/check-username`
verifica disponibilidade. O `pinTurma` é gerado no cadastro da turma e recebe **backfill**
ao abrir turmas antigas (`TurmaService.buscarTurma`). Na busca, `GET /portal/professor/...`
devolve também o **avatar** do professor (âncora visual do card de resultado).

### Smart PINs (2 dígitos) e migração

Para reduzir o atrito no login em aula, os PINs são **curtos e memorizáveis**:

- **PIN da turma:** 2 dígitos, único entre as turmas **ativas** do professor (`proximoPinCurto`).
- **PIN do aluno:** 2 dígitos **sequenciais** ('01', '02', …), único por turma, atribuído no cadastro.
- **Limites estruturais:** máximo de **99 turmas ativas** por professor e **99 alunos** por turma
  (`LIMITE_TURMAS_ATIVAS` / `LIMITE_ALUNOS_TURMA` → 400 `LIMITE_TURMAS` / `LIMITE_ALUNOS`).
- **Migração transparente:** turmas legadas (PIN 6 díg) migram via `POST /turmas/:id/migrar-pins`
  (`TurmaService.migrarPins`), que regenera o PIN da sala e **redistribui** os PINs dos alunos em
  sequência. Enquanto não migram, seguem funcionando: os DTOs aceitam 2–6 díg (turma) / 2–4 díg
  (aluno), e o portal informa `pinLength`/`pinAlunoLength` para o front exibir o nº certo de slots.

### Arquivamento de turmas, reciclagem de PIN e Hall da Fama

- **Encerrar turma** (`POST /turmas/:id/encerrar`) marca `encerradaManualmente`: a turma vira
  **somente-leitura** — 400 `TURMA_ENCERRADA` ao adicionar alunos (`AlunoService.adicionar`) ou
  iniciar uma partida (`PartidaService.criar`).
- **Reciclagem de PIN:** como a geração só considera turmas **ativas** (`contaComoAtiva`), encerrar
  uma turma **devolve automaticamente** o PIN de 2 díg ao pool para a próxima turma.
- **Hall da Fama:** as turmas encerradas viram mural **público, sem PIN** — `GET /portal/.../hall`
  (lista) e `GET /portal/turma/:id/hall` (ranking final). Turma ainda ativa não é pública (404).

### Tichr Qlick: relação N:N com as turmas

Um Qlick é uma definição **reutilizável** da biblioteca do professor, atribuível a **várias turmas**
(`QlickEntity.turmaIds`, com `turmaId` legado unificado pelo getter `turmas`). A atribuição vem do
estúdio (create/update) ou de `PUT /qlicks/:id/turmas`. A **partida escolhe a turma no início**
(`POST /qlicks/:id/partida { turmaId }`): valida que o Qlick está atribuído à turma e que ela não está
encerrada; o crédito de XP usa a turma da partida.

### Trava de `@username` (cooldown de 60 dias)

O handle é um identificador estável — não pode ser volátil. Quando o `PUT /profile` **muda**
o `username`, `ProfessorService.updateProfile` grava `lastUsernameChange`; novas trocas só
são permitidas após **60 dias** (`ProfessorEntity.diasParaTrocarUsername`). Dentro do
período, a API responde **409** `{ code: 'USERNAME_COOLDOWN', diasRestantes }` e o front
desabilita o campo exibindo a microcópia. Salvar outros campos mantendo o mesmo handle
**não** reinicia o relógio.

### Plano de Aula (escopo geral, tópicos e alocação)

O **Plano de Aula** escala com o plano do professor (`PlanoAulaModule`, independente):

- **Graduado — escopo geral + quadro modular:** um texto macro (Syllabus) por disciplina
  (`planos_aula`, upsert em `PUT /planos-aula`) **e** o backlog de **tópicos** (`topicos`) com a
  **alocação** arrasta-e-solta — tudo já no Graduado. `403 PLANO_LOCKED` para o Estagiário.
- **Tópicos + alocação:** o professor cria um backlog de **tópicos** (`topicos`) e os
  **aloca** às aulas por arrastar-e-soltar. A alocação (`alocacoes`) é ancorada no
  **`numeroAula`**, não na data — como a reprojeção regenera as sessões mantendo o `numero`, o
  **tópico desliza junto com a aula** automaticamente quando a grade recalcula. Excluir um
  tópico limpa suas alocações.
- **PhD — sincronização com o portal:** `GET /aluno/plano` devolve os tópicos alocados às aulas
  da turma do aluno (join `alocacoes` × `topicos` por número), **apenas quando o professor é
  PhD** — alimentando o "o que já vimos" (aulas concluídas) e "o que vem por aí" (próxima aula)
  no portal.

### Tichr Qlick (quiz em tempo real, CQRS)

O Tichr Qlick é um quiz ao vivo estilo Kahoot, **PhD-exclusivo** para criação
(`ProfessorEntity.podeGamificar`). A arquitetura é **CQRS híbrida sobre o Firestore**:

- **Comandos via REST** — toda escrita passa pelo backend (Admin SDK). O professor comanda
  a partida (`iniciar`/`apurar`/`proxima`/`encerrar`) e o aluno envia inscrição e resposta.
  O backend é a **única** fonte de escrita em `qlick_partidas`.
- **Estado por realtime** — o cliente **lê** o documento da partida via `onSnapshot`
  (Firebase JS SDK reintroduzido no front, **somente leitura**). Cada transição de estado
  regrava o doc e todos os dispositivos reagem no mesmo instante, sem polling.

**Máquina de estados** da partida (`PartidaService`):

```
LOBBY ──iniciar──▶ QUESTAO_ATIVA ──apurar──▶ RANKING_PARCIAL ──proxima──▶ QUESTAO_ATIVA
                                                     │
                                                  encerrar
                                                     ▼
                                                 ENCERRADO
```

- **Apuração automática:** ao responder, o backend conta as respostas da pergunta; quando
  **todos os inscritos** responderam, `apurar` dispara sozinho (o professor não precisa
  esperar o timer). O professor também pode forçar `apurar` a qualquer momento.
- **Pontuação** (`computarPontos`): acerto vale `PONTOS_ACERTO = 1000` mais um **bônus de
  rapidez** proporcional ao tempo restante (`BONUS_RAPIDEZ = 500` no limite instantâneo);
  erro vale `0`.
- **XP no encerramento:** `encerrar` converte o placar final em XP do portal via
  `XpService.creditarPartida` (motivo `QLICK`, `FieldValue.increment` para não competir com
  a base passiva) — **só** quando a partida tem `turmaId`. É **idempotente**: encerrar uma
  partida já encerrada retorna **400**, evitando crédito em dobro.

**Sigilo da resposta certa.** O `corretaIndex` do Qlick **nunca** vai ao cliente durante a
pergunta: o doc público expõe só `perguntaPublica` (enunciado + alternativas). A correta é
gravada no doc apenas ao entrar em `RANKING_PARCIAL`. As respostas cruas ficam em
`qlick_respostas`, coleção **server-only**.

**Regras do Firestore** (`firestore.rules`, deploy manual): o cliente só **lê**
`qlick_partidas`; todo o resto (incluindo `qlick_respostas`, `qlicks`, `alunos`,
`xp_logs`) é `read:false, write:false` — o Admin SDK ignora as rules e continua com acesso
total. Assim, mesmo lendo o realtime, o aluno não alcança as respostas nem forja pontos.

### Painel Administrativo (backoffice) e cupons
O backoffice é um módulo isolado (`AdminModule`) protegido pelo `AdminGuard`. O
acesso admin é **centralizado no Firestore**: o campo **`professores/{uid}.isAdmin`**
é a **fonte de verdade**. O `AdminGuard` lê esse campo a cada chamada de `/admin/*`
(um admin continua sendo `PROFESSOR` nas rotas normais). O front decide exibir o
atalho "Painel Admin" pelo `GET /admin/ping` e pelo `isAdmin` do `GET /profile`.
Assim, promover/revogar vale **na hora** — sem redeploy e sem re-login.

O backoffice também tria os **feedbacks** dos professores (`FeedbackModule`, com o
`AdminFeedbackController` protegido pelo mesmo `AdminGuard` — o padrão do
`AdminCupomController`: controller admin morando no módulo da feature). O canal é
`POST /feedbacks`, aberto a qualquer professor; a triagem é `/admin/feedbacks`.

**Notificação e a assincronia que não é silenciosa.** Gravado o documento, o serviço monta o
HTML e dispara pela **Resend** (`src/feedback/resend.ts` — funções puras + `fetch`, no molde do
`identity-toolkit.ts`; sem SDK). A chamada **não é aguardada**: o professor recebe o `201` assim
que o Firestore confirma, sem pagar a latência de um provedor externo. Mas *fire-and-forget* puro
esconde falha, então o sucesso carimba **`notificadoEm`** e o erro vai para o `Logger` — a inbox
exibe *"alerta não enviado"* quando o campo falta. Sem `RESEND_API_KEY` ou sem nenhum professor
`isAdmin`, o envio é pulado com um `warn` e **o feedback é salvo do mesmo jeito** (é o que
acontece em dev, e é deliberado: ninguém perde um relato porque o e-mail do admin está mal
configurado).

**Quem recebe.** Os destinatários são os professores com **`isAdmin: true`** no Firestore — a
mesma fonte que o `AdminGuard` usa para liberar o backoffice, resolvida em e-mail via `getUsers`
do Auth. Não há env de lista: quem pode triar o feedback é exatamente quem é avisado dele, e
promover um admin pelo painel já passa a alertá-lo, sem redeploy (a lista em env foi tentada e
descartada pelo mesmo motivo que o `ADMIN_EMAILS` caiu no controle de acesso, na 008).

**O único escape de HTML do backend.** O template (`src/feedback/email-template.ts`) é a primeira
superfície de HTML do projeto — em todo o resto quem escapa é o Angular, e o Firestore não tem
injeção de SQL. Como ele interpola texto que o professor escreveu, **toda** interpolação passa
pelo `escaparHtml`; sem isso, um relato poderia injetar um link de phishing no e-mail que o admin
abre confiando. O que é gravado, esse sim, não é sanitizado: o relato vale pelo que ele diz.

- **Métricas** (`AdminService.metrics`): lê `professores` + `turmas` e agrega em
  memória (total, ativos = ≥1 turma vigente via `TurmaEntity.contaComoAtiva`,
  desativados e distribuição por plano).
- **CRM** (`GET /admin/usuarios`): junta `professores` + uso (`turmas`/`alunos`/`qlicks`)
  e os e-mails do Firebase Auth (`getUsers` em lotes). Busca por nome/username/e-mail.
- **Ações**: reset de senha (Identity Toolkit `sendOobCode`), limpar dados
  (apaga turmas/alunos/qlicks, mantém o login), soft-delete (`desativadoEm`) ou
  hard-delete (dados + `deleteUser`), override de plano e concessão de admin.
- **Cupons** (`CupomModule`): `PLANO_GRATIS` (concede um plano) ou `MESES_GRATIS`
  (define `cortesiaAte = hoje + meses`). A aplicação (`POST /checkout/cupom`) roda
  numa **transação** que revalida o limite (`maxUsos`) e incrementa `usos`.

**Como criar/promover um administrador (Firestore):**
1. **Primeiro admin (bootstrap manual):** faça login uma vez com a conta
   (garante o doc `professores/{uid}`), pegue o **uid** no Firebase Console →
   **Authentication**, e no Firestore abra `professores/{uid}` e adicione o campo
   **`isAdmin`** (boolean) = **true**. Recarregue o app — sem redeploy, sem re-login.
2. **Demais admins (pelo painel):** com um admin já ativo, abra **/admin/usuarios**,
   selecione o professor e clique em **"Tornar admin"** (`POST /admin/usuarios/:uid/admin
   { conceder: true }` → grava `isAdmin: true` no doc). Para revogar, "Revogar admin".

> Segurança: o `isAdmin` só é escrito pelo backend (Admin SDK) ou pelo dono no
> Console — o `UpdateProfileDto` não expõe o campo e o `ValidationPipe` roda com
> `whitelist`/`forbidNonWhitelisted`, então um professor não se auto-promove.

---

## Tichr Wor (guerra de castelos, PvP em tempo real)

Releitura competitiva da forca: equipes decifram palavras defendendo o **HP** de
suas fortalezas ao longo de várias **ondas** (o dano persiste entre palavras).
Mesmo padrão do Qlick — definição em coleção própria + jogo ao vivo lido pelo
cliente via `onSnapshot`, com **escrita só pelo backend** (Admin SDK).

### Estrutura de dados
- **`wor_jogos`** (arsenal, server-only): `professorId`, `nome`, `disciplina?`,
  `topico`, `palavras: [{ id, palavra, dicas[] }]` (até 3 dicas por palavra).
- **Estado fragmentado da partida** (leitura pública, escrita negada):
  - **`matches/{id}`** (raiz): `status` (LOBBY/EM_ANDAMENTO/ENCERRADO), `ondaIndex`,
    `mascara[]` (letra / `_` / espaço), `letrasTentadas[]`, `cartasVisiveis[]`,
    `turnoEquipeId`, `ordemEquipes[]`, `acoesRodada[]`, `rodadaIniciadaEm`, `placar[]`,
    `resumoRodada`, `lastGlobalAction`, `inscritos[]`, `vencedorEquipeId`.
    **Não** guarda o segredo (palavra/dicas ficam em `wor_jogos`).
  - **`matches/{id}/teams/{teamId}`**: `hp`, `isHorde`, `cor`, `nome`, `pontos`,
    `membros[]`, `lastGlobalAction`.
    O **aluno escuta só o próprio time** → dano/cura dispara barato; o **professor**
    escuta a raiz + todos os times (1 leitura por ação no telão).

#### Action Cards (`lastGlobalAction`) — narração global + freeze
Ação de impacto é narrada ao mesmo tempo em **todas** as telas. Como o aluno só
escuta o doc da própria equipe, o evento vai por **fan-out**: o mesmo objeto é
gravado na raiz (telão) **e em cada equipe**, num **único `WriteBatch`** junto do
seu efeito (dano, cura, troca de turno) — `WorMatchRepository.commitPartida`.

- Formato: `{ seq, tipo, mensagem, duracaoMs, em }`, com `tipo` em
  `ATAQUE | CURA | USURPACAO | DANO_CRITICO | DICA`. O cliente detecta `seq` novo,
  exibe o card por `duracaoMs` (3s) e trava os inputs.
- **Freeze:** não existe timer no servidor para pausar — o cronômetro é derivado de
  `rodadaIniciadaEm`. Congelar = gravar esse instante **3s no futuro** (`WOR.FREEZE_MS`).
  O relógio dos clientes não corre durante o card e `resolverPorTempo` não fecha a
  rodada no meio da narração. Nada precisa ser "destravado" depois.
- **Um card por requisição:** se a rodada resolve na mesma ação em que alguém sofreu
  Dano Crítico, o card do crítico prevalece (a resolução ainda chega pelo `resumoRodada`).

### Endpoints — Arsenal & IA (professor)
| Método | Rota | Descrição |
|---|---|---|
| `GET/POST/PUT/DELETE` | `/wor/jogos[/:id]` | CRUD do arsenal (posse validada) |
| `POST` | `/wor/jogos/arsenal` `{ instrucao, disciplina?, topico? }` | Forja o arsenal por **IA (Gemini)** — **5 palavras com 3 dicas** cada, a partir da instrução do professor + contexto. Exclusivo do **PhD** (403 `WOR_LOCKED`); **rate limit 1×/dia/professor** (429 `IA_RATE_LIMIT`, cota só consumida quando a IA devolve um arsenal válido); 503 `IA_INDISPONIVEL`/`IA_SEM_RESULTADO` |

### Endpoints — Partida (professor / orquestrador)
| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/wor/jogos/:jogoId/partida` `{ turmaId }` | cria a partida (lobby) amarrada a uma turma |
| `GET` | `/wor/matches/:id` | estado (raiz + times) |
| `POST` | `/wor/matches/:id/distribuir` `{ numeroEquipes }` | forma equipes (round-robin dos inscritos) |
| `POST` | `/wor/matches/:id/iniciar` | inicia a batalha (define o 1º turno) |
| `POST` | `/wor/matches/:id/pular` | mestre pula a palavra travada |
| `POST` | `/wor/matches/:id/tempo` | projetor fecha a rodada por tempo esgotado (o servidor revalida o prazo) |

### Endpoints — Ações do aluno (`@Roles('STUDENT')`, mesmo login do Qlick)
| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/aluno/wor` | partida ativa da turma do aluno |
| `POST` | `/aluno/wor/:id/entrar` | inscreve o aluno no lobby |
| `POST` | `/aluno/wor/:id/letra` `{ letra, acao, alvoEquipeId? }` | chuta a letra **e vota** a ação da equipe (atacar rival / comprar dica) |
| `POST` | `/aluno/wor/:id/arriscar` `{ palavra }` | **Risco Heroico** (cura + encerra onda) / **Invasão** da Horda (usurpação) |

### Regras (constantes em `WOR`, ajustáveis)
O turno é **da equipe**: cada membro age uma vez (letra + voto) e a rodada resolve
quando todos jogaram — ou quando o cronômetro (`LIMITE_RODADA_MS`, 60s) zera.

HP inicial **1000** · Ataque **100** · Ataque perfeito (todos acertaram, equipe 2+)
**200** · Cura Massiva **400** · Bônus de Risco Heroico **+300 pontos** · até **3 cartas** ·
freeze do Action Card **3s**. **Errar a letra não causa dano.** **Horda:** HP 0 → só pode
Invasão; se acertar, **rouba o castelo do líder** (maior HP), que vira a nova Horda.
Vitória: maior HP ao fim das ondas, desempate por pontos.

**Economia de XP:** o dano vira **pontos de combate** da equipe atacante; no fim, o HP
restante vira pontos (`BONUS_HP_FATOR`) e os pontos viram XP da turma —
`XP = pontos × XP_POR_PONTO (0,1)`, cheio para a campeã e **metade** para as demais
(`XpService.creditarPartida`, motivo `WOR`).

### Env & rules
- **`GEMINI_API_KEY`** (Vercel): habilita a geração do arsenal por IA (sem ela, palavras e dicas manuais).
- `firestore.rules`: `matches/**` **leitura pública, escrita negada** (o Admin SDK ignora).

---

## Tichr Isolateus (dedução social + defesa pedagógica)

Uma vila isolada, um infiltrado. A turma responde questões da matéria para defender
os 6 setores e debate para descobrir quem é a **Ameaça**. Exclusivo do plano **PhD**
(`ISOLATEUS_LOCKED`).

### A regra que governa o desenho: o segredo nunca toca o Firestore

O jogo só existe enquanto ninguém souber quem é o Alienígena. Por isso o estado é
partido em **duas coleções**: o cliente escuta uma, e a outra ele nem consegue ler.
Nenhuma informação oculta transita pela rede até o navegador — nem no `onSnapshot`,
nem em payload de resposta.

### Estrutura de dados

- **`isolateus_jogos`** (definição, server-only): `professorId`, `nome`, `disciplina?`,
  `topicoId?`, `turmaId?` (legado), `turmaIds?[]`, `duracaoSegundos`, `questoes[]`
  (`enunciado`, `alternativas[]`, `corretaIndex`). O `corretaIndex` mora aqui — coleção fechada.
- **`isolateus_partidas`** (camada **pública**, lida por `onSnapshot`): `status`, `criadaEm`,
  `esperanca` (0..100), `setores[]` (`id`, `nome`, `intacto`), `habitantes[]`
  (`id` **opaco/UUID**, `nome`, `vivo`, `preso` — **sem marca de NPC**), `rodada`,
  `totalRodadas`, `duracaoSegundos`, `faseIniciadaEm`, `questaoPublica` (**sem** a correta),
  `corretaIndex` (só em `RESULTADO_RODADA`), `alerta`, `rumores[]`, `debate[]`,
  `resumoRodada`, `quarentenaRodada` (rodada da última Quarentena; cabe uma por
  rodada), `vereditoQuarentena`, `votosRecebidos`, `pulosRecebidos` (**só a
  contagem** — quem pulou o debate mora no cofre),
  `inscritos[]` (**esvaziado ao iniciar**), `veredito`, `rankingFinal[]` (**só no fim**).
- **`isolateus_segredos`** (o **cofre**, deny-all): `alienAlunoId`, `vinculos[]`
  (`habitanteId` → `alunoId`; sem `alunoId` = NPC), `acaoRodada`, `pulosDebate[]`
  (quem pulou o debate — a lista denunciaria quem é real), `pontos{}`.
- **`isolateus_respostas`** / **`isolateus_votos`** (deny-all): doc-id determinístico
  (`{partidaId}_{rodada}_{alunoId}` nos dois) = idempotência **por rodada** — é o
  que permite uma Quarentena nova sem reaproveitar os votos da anterior.

Partida e cofre são gravados no **mesmo `WriteBatch`** (`commitPartida`) — a vila nunca
vê um alerta cuja ação ainda não foi registrada, nem o contrário.

### Estados

`LOBBY → TURNO_AMEACA → QUESTAO_ATIVA → RESULTADO_RODADA → (próxima noite) …`
com desvio opcional para `QUARENTENA_DEBATE → QUARENTENA_VOTO` e saída em `ENCERRADO`.

### Endpoints — Investigação & IA (professor)
- `POST /isolateus/jogos/questoes` — gera **10 questões** por IA (Gemini). Rate limit
  **1×/dia** com contador próprio (`isolateusIaUltimoUso`), separado do Qlick e do Wor;
  a cota só é consumida no sucesso. Não persiste — devolve para o professor editar.
- `GET|POST /isolateus/jogos` · `GET|PUT|DELETE /isolateus/jogos/:id`

### Endpoints — Partida (professor / telão)
- `POST /isolateus/jogos/:jogoId/partida` — cria no `LOBBY`.
- `GET /isolateus/matches/:id`
- `POST /isolateus/matches/:id/vetar/:alunoId` — auditoria do pseudônimo (aprovar é implícito).
- `POST /isolateus/matches/:id/renomear/:alunoId` — corrige o apelido **sem** tirar o aluno do lobby
  (`{ pseudonimo }`; mesma checagem de colisão do `entrar`). **Só no `LOBBY`**: ao iniciar, o vínculo
  aluno↔pseudônimo é apagado de propósito, e nem o professor pode desfazê-lo.
- `POST /isolateus/matches/:id/iniciar` — **o Despertar**: preenche a vila com NPCs e sorteia a Ameaça.
- `POST /isolateus/matches/:id/tempo` — o telão fecha a fase cronometrada (**não há timer no servidor**;
  o servidor revalida o prazo com margem de 2s).
- `POST /isolateus/matches/:id/proxima` · `POST /isolateus/matches/:id/quarentena`

### Endpoints — Ações do aluno (`@Roles('STUDENT')`, mesmo login do Qlick/Wor)
- `GET /aluno/isolateus` — a investigação ativa da turma (janela de 12h).
- `POST /aluno/isolateus/:id/entrar` — o **Voto de Silêncio**: entra com um pseudônimo.
- `GET /aluno/isolateus/:id/painel` — **a única porta do segredo**: devolve o papel do aluno e,
  **só para a Ameaça**, o `corretaIndex` da questão no ar e os disfarces (nomes de NPC).
  O Aldeão recebe apenas o próprio papel — nem inspecionando o payload ele ganha vantagem.
- `POST /aluno/isolateus/:id/acao` — Turno da Ameaça (`SABOTAR` um setor | `ABDUZIR` um morador).
- `POST /aluno/isolateus/:id/resposta` — a defesa. **Abduzidos e presos continuam pontuando.**
- `POST /aluno/isolateus/:id/rumor` — o rumor forjado da Ameaça (1×/noite, sob nome de NPC).
- `POST /aluno/isolateus/:id/sinal` — o Sinal de Rádio anônimo de quem saiu da vila.
- `POST /aluno/isolateus/:id/quarentena` · `/debate` · `/pular-debate` · `/suspeito`
  — `/pular-debate` é o avanço rápido do chat: idempotente, publica só a **contagem**
  (`pulosRecebidos`) e abre a votação quando todos os reais na vila já pularam.

### Regras (constantes em `ISOLATEUS`, ajustáveis)

Mínimo de **4** investigadores reais. **Névoa de Guerra:** abaixo de 10 reais, a vila ganha
`reais - 1` NPCs (nomes de `NOMES_NPC`); com 10+, nenhum. **A Ameaça é sempre um habitante real.**

Esperança inicial **100** · sabotagem **−15** · abdução **−10** · inocente preso **−20**.
Esperança em 0 = vitória da Ameaça.

**Apuração:** votam os reais na vila + os NPCs (aleatório). No empate vale o **Instinto Humano** —
ganha a alternativa mais votada pelos **reais**; persistindo, a de menor índice (determinístico).

**Quarentena:** **uma por rodada** (a opção volta a cada noite), convocada por qualquer real vivo
ou pelo professor. Debate **90s** → votação **60s**, os dois com avanço rápido: no debate, quando
todos os reais na vila pulam (`POST /aluno/isolateus/:id/pular-debate`); na votação, no consenso.
Prendeu a Ameaça → Vila vence; prendeu inocente → −20 de Esperança e **a identidade do preso
permanece em segredo**.

**Fim por esgotamento das questões (§8):** a **Ameaça é avaliada primeiro** (abduziu mais da metade
da população **ou** destruiu mais de 3 setores); só então a Vila (mais de 3 setores intactos **ou**
mais da metade sobreviveu). Sem nenhum critério batido, vence a Vila por resistência. O veredito
carrega o **motivo técnico** exibido no card.

**Economia de XP:** acerto **1000** + bônus de rapidez até **500** (proporcional ao tempo restante);
sabotagem validada (a vila errou) credita **1000 à Ameaça**; o lado vencedor leva **+1000** de
Vitória de Partida. Os pontos ficam no cofre e viram XP **1:1** no encerramento
(`XpService.creditarPartida`, motivo `ISOLATEUS`).

### Env & rules
- **`GEMINI_API_KEY`** (Vercel): habilita a geração das 10 questões (sem ela, escrita manual).
- `firestore.rules`: `isolateus_partidas/{id}` **leitura pública, escrita negada**;
  `isolateus_segredos`, `isolateus_respostas` e `isolateus_votos` ficam no **deny-all** — é isso que
  impede o DevTools de revelar o infiltrado.
