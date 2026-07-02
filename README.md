# Tichr — Backend

API do Tichr, um sistema de agendamento de aulas **orientado a regras**: em vez de o
professor cadastrar aula por aula, o backend **projeta as aulas** a partir das regras da
turma (dias da semana + modalidade) e dos descontos do calendário (exceções e férias).

Stack: **NestJS 11** + **Firebase Firestore** (dados) + **Firebase Auth** (identidade).
Padrão **Controller → Service → Repository**, com as regras de negócio nas **entidades**.

---

## Sumário

- [Setup](#setup)
- [Arquitetura](#arquitetura)
- [Estrutura de dados](#estrutura-de-dados-firestore)
- [Endpoints](#endpoints)
- [Regras de negócio](#regras-de-negócio)

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
- **Módulos**: `FirebaseModule` (global), `AuthModule`, `TurmaModule` (turmas, sessões,
  exceções e férias), `ProfessorModule`.
- **Datas** trafegam como string **`YYYY-MM-DD`** (dia de calendário em UTC) — elimina o
  off-by-one de fuso/horário de verão.

### Autenticação

- `AuthGuard` **global** protege todas as rotas; rotas abertas usam `@Public()`.
- O guard extrai o `Bearer <idToken>` do header `Authorization` e valida via
  `admin.auth().verifyIdToken()`. O `uid` decodificado vira o `professorId`
  (injetável com `@ProfessorId()`).
- **O backend é o intermediário do login**: `POST /auth/login` recebe email/senha e
  chama a REST do Identity Toolkit (`accounts:signInWithPassword`) com a
  `FIREBASE_WEB_API_KEY`, devolvendo o ID token do Firebase. O frontend não conhece o
  Firebase — só guarda o token e o envia como `Bearer`.

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

---

## Endpoints

Todas as rotas exigem `Authorization: Bearer <idToken>`, exceto as marcadas
**pública**. `professorId` vem sempre do token.

### Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/auth/login` **(pública)** | `{ email, password }` | `{ token, refreshToken, expiresIn, uid, email }` |
| `GET` | `/` **(pública)** | — | health check |

### Turmas
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/turmas` | `CreateTurmaDto` | `{ turma, sessoes }` |
| `GET` | `/turmas` | — | `TurmaEntity[]` |
| `GET` | `/turmas/:id` | — | `TurmaEntity` (404 se não for do professor) |
| `PUT` | `/turmas/:id` | `UpdateTurmaDto` | `{ turma, sessoes }` — **reprojeta** |

`CreateTurmaDto`: `nome`, `tipoModalidade`, `diasSemana[]`, `dataInicio`,
`totalAulas?` (obrigatório se módulo), `cor?` (`#RRGGBB`), `disciplina?`,
`horaInicio?`/`horaFim?` (`HH:mm`). `UpdateTurmaDto` = os mesmos, todos opcionais.

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
| `GET` | `/profile` | — | `ProfessorEntity` (perfil **vazio** só com `uid` se ainda não existe — 200, não 404) |
| `PUT` | `/profile` | `{ nomeExibicao?, disciplina?, bio?, disciplinas?[] }` | `ProfessorEntity` (upsert com merge) |

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
