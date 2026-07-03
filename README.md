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
| `JWT_SECRET` | Segredo para assinar/validar o JWT do portal do aluno. **Defina em produção** (há um fallback de desenvolvimento). |
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
  **agrupamento**, **XP** e **ranking**), `ProfessorModule` (perfil + **checkout/planos**).
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

**Login do professor** — o backend é o intermediário: `POST /auth/login` recebe
email/senha e chama a REST do Identity Toolkit (`accounts:signInWithPassword`) com a
`FIREBASE_WEB_API_KEY`, devolvendo o ID token do Firebase. O frontend não conhece o
Firebase — só guarda o token e o envia como `Bearer`.

**Login do aluno** — alunos não têm e-mail: `POST /auth/aluno` recebe `turmaId` + `PIN`
(4 dígitos), casa com o Firestore e emite um **JWT próprio** com
`{ role: 'STUDENT', alunoId, turmaId }` (validade 30 dias). O aluno só enxerga a própria
turma e o próprio perfil.

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

> Os 5 campos de config têm defaults aplicados no getter `TurmaEntity.configPontuacao`
> — turmas antigas sem os campos assumem `XP`/ativos.

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
| `planoAtual` | `'ESTAGIARIO' \| 'GRADUADO' \| 'MESTRE' \| 'PHD'` (default `ESTAGIARIO`) |
| `slotsAdicionaisComprados` | number (default `0`) — vagas avulsas somadas ao limite do plano |

### `alunos`
Lista de chamada de uma turma (não é conta do Firebase). Ganha PIN e XP para o portal.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `turmaId` | string | |
| `nome` | string | |
| `tagsPerfil` | string[]? | tags livres para dinâmicas |
| `pinAcesso` | string? | PIN de 4 dígitos, **único por turma**, gerado no cadastro |
| `xpTotal` | number | pontuação materializada (soma dos `xp_logs`) |
| `equipeId` | string \| null? | equipe persistente do aluno; `null`/ausente = **sem equipe** (pool) |
| `cargoIds` | string[]? | cargos atribuídos ao aluno (relação **N↔N** com `cargos`) |

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

### `xp_logs`
Registro (event sourcing) de cada distribuição de pontos.

| Campo | Tipo | Observação |
|---|---|---|
| `id` / `alunoId` / `turmaId` | string | |
| `pontos` | number | delta aplicado (pode ser negativo) |
| `motivo` | string? | |
| `data` | string | ISO datetime |

---

## Endpoints

Todas as rotas exigem `Authorization: Bearer <idToken>`, exceto as marcadas
**pública**. `professorId` vem sempre do token.

### Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/auth/login` **(pública)** | `{ email, password }` | `{ token, refreshToken, expiresIn, uid, email }` |
| `POST` | `/auth/aluno` **(pública)** | `{ turmaId, pin }` | `{ token, aluno, turma: { nomePontuacao, rankingAtivo } }` — JWT de aluno + config da turma |
| `GET` | `/auth/turma/:turmaId` **(pública)** | — | `{ turmaId, turmaNome, alunos: [{ id, nome }], config: { nomePontuacao, rankingAtivo } }` — info da tela de login do aluno |
| `GET` | `/` **(pública)** | — | health check |

### Turmas
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/turmas` | `CreateTurmaDto` | `{ turma, sessoes }` — barrado pelo **`PlanosGuard`** (403 `LIMIT_REACHED` se estourar a cota) |
| `GET` | `/turmas` | — | `TurmaEntity[]` |
| `GET` | `/turmas/:id` | — | `TurmaEntity` (404 se não for do professor) |
| `PUT` | `/turmas/:id` | `UpdateTurmaDto` | `{ turma, sessoes }` — **reprojeta**; aceita `encerradaManualmente` |

`CreateTurmaDto`: `nome`, `tipoModalidade`, `diasSemana[]`, `dataInicio`,
`totalAulas?` (obrigatório se módulo), `cor?` (`#RRGGBB`), `disciplina?`,
`horaInicio?`/`horaFim?` (`HH:mm`), e a **config de pontuação** `pontuacaoAtiva?`,
`nomePontuacao?`, `rankingAtivo?`, `rotuloAdicionar?`, `rotuloRemover?`. `UpdateTurmaDto` =
os mesmos, todos opcionais, + `encerradaManualmente?`.

### Checkout / planos
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `POST` | `/checkout/slot-avulso` | — | `ProfessorEntity` — `slotsAdicionaisComprados += 1` |
| `POST` | `/checkout/upgrade` | `{ plano }` | `ProfessorEntity` — troca o `planoAtual` |

> Mock — ainda sem gateway de pagamento; apenas ajustam o estado do plano no perfil.

### Alunos e gamificação
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/turmas/:turmaId/alunos` | — | `AlunoEntity[]` |
| `POST` | `/turmas/:turmaId/alunos` | `{ nomes: string[] }` | `AlunoEntity[]` — cadastro **em lote** (gera PIN/turma) |
| `DELETE` | `/turmas/:turmaId/alunos/:alunoId` | — | `{ removido: true }` |
| `PATCH` | `/turmas/:turmaId/alunos/:alunoId/equipe` | `{ equipeId: string \| null }` | `AlunoEntity` — move o aluno para uma equipe (drop) ou de volta ao pool (`null`) |
| `POST` | `/turmas/:turmaId/alunos/:alunoId/xp` | `{ pontos, motivo? }` | `{ alunoId, xpTotal }` — grava log + atualiza total. **400** se `pontuacaoAtiva=false` |
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

### Portal do aluno (`@Roles('STUDENT')`)
| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/aluno/me` | `AlunoEntity` — perfil do próprio aluno (XP) |
| `GET` | `/aluno/agenda` | `SessaoAulaEntity[]` — sessões (já recalculadas) da própria turma |

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

### Planos e cota de turmas

Cada plano tem um **limite base** de turmas ativas simultâneas, somado às vagas avulsas:

| Plano | Limite base |
|---|---|
| `ESTAGIARIO` | 2 |
| `GRADUADO` | 5 |
| `MESTRE` / `PHD` | ilimitado |

`limite = base(plano) + slotsAdicionaisComprados`. Uma turma **ocupa cota**
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
- A config pública (`nomePontuacao`, `rankingAtivo`) viaja ao **portal do aluno** no login
  (`POST /auth/aluno`) e no `GET /auth/turma/:turmaId`, para o front rotular sem hardcode.
