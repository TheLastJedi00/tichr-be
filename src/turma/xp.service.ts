import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { hojeISO } from '../common/date.util';
import { dividirIgual } from '../common/dividir';
import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorService } from '../professor/professor.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';

/** Pontuação base concedida por aula concluída (evolução passiva da turma). */
export const BASE_POR_AULA = 10;

@Injectable()
export class XpService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly turmaRepo: TurmaRepository,
    private readonly alunoRepo: AlunoRepository,
    private readonly professorService: ProfessorService,
    private readonly sessaoRepo: SessaoRepository,
  ) {}

  /**
   * Sincroniza a "pontuação base" passiva: recompensa cada aluno pelas aulas já
   * concluídas que ainda não foram contabilizadas. Idempotente — `baseAteSessao`
   * guarda quantas aulas concluídas já renderam base, então reprocessar não
   * duplica. Silencioso quando a turma não gamifica.
   */
  async sincronizarBaseTurma(turmaId: string): Promise<void> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || !turma.configPontuacao.pontuacaoAtiva) {
      return;
    }
    const professor = await this.professorService.getProfile(turma.professorId);
    if (!professor.podeGamificar) {
      return;
    }

    const hoje = hojeISO();
    const sessoes = await this.sessaoRepo.findByTurma(turmaId);
    const concluidas = sessoes.filter(
      (s) => s.status !== 'CANCELADA' && s.data < hoje,
    ).length;
    if (concluidas === 0) {
      return;
    }

    const alunos = await this.alunoRepo.findByTurma(turmaId);
    const db = this.firebase.firestore;
    const batch = db.batch();
    let mudou = false;

    for (const aluno of alunos) {
      const base = aluno.baseAteSessao ?? 0;
      if (base >= concluidas) {
        continue;
      }
      const pontos = (concluidas - base) * BASE_POR_AULA;
      batch.update(db.collection('alunos').doc(aluno.id), {
        xpTotal: (aluno.xpTotal ?? 0) + pontos,
        baseAteSessao: concluidas,
      });
      batch.set(db.collection('xp_logs').doc(), {
        alunoId: aluno.id,
        turmaId,
        pontos,
        motivo: 'BASE',
        data: new Date().toISOString(),
      });
      mudou = true;
    }

    if (mudou) {
      await batch.commit();
    }
  }

  /**
   * Distribui XP a um aluno: grava um evento em `xp_logs` e atualiza o
   * `xpTotal` do aluno numa transacao Firestore (mantem log e total coerentes).
   * O total nunca fica negativo.
   */
  async distribuir(
    professorId: string,
    turmaId: string,
    alunoId: string,
    pontos: number,
    motivo?: string,
  ): Promise<{ alunoId: string; xpTotal: number }> {
    const turma = await this.turmaRepo.findById(turmaId);
    if (!turma || turma.professorId !== professorId) {
      throw new NotFoundException('Turma nao encontrada.');
    }
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.podeGamificar) {
      throw new ForbiddenException({
        code: 'GAMIFICACAO_LOCKED',
        message: 'A gamificacao e exclusiva do plano PhD.',
      });
    }
    if (!turma.configPontuacao.pontuacaoAtiva) {
      throw new BadRequestException('A pontuacao esta desativada nesta turma.');
    }
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId) {
      throw new NotFoundException('Aluno nao encontrado.');
    }

    const db = this.firebase.firestore;
    const alunoRef = db.collection('alunos').doc(alunoId);
    const logRef = db.collection('xp_logs').doc();

    const novoXp = await db.runTransaction(async (tx) => {
      const snap = await tx.get(alunoRef);
      const atual = (snap.data()?.xpTotal as number | undefined) ?? 0;
      const novo = Math.max(0, atual + pontos);
      tx.update(alunoRef, { xpTotal: novo });
      tx.set(logRef, {
        alunoId,
        turmaId,
        pontos,
        motivo: motivo ?? null,
        data: new Date().toISOString(),
      });
      return novo;
    });

    return { alunoId, xpTotal: novoXp };
  }

  /**
   * Debita XP de um aluno por uma penalidade de jogo (ex.: linguagem imprópria
   * no chat do Wor). Como o crédito das partidas, dispensa o gate de
   * `pontuacaoAtiva` — o jogo é a opção de gamificar. Nunca deixa o XP negativo
   * (transação, como `distribuir`). Aluno fora da turma: ignorado.
   */
  async penalizarJogo(
    turmaId: string,
    alunoId: string,
    pontos: number,
    motivo:
      | 'WOR_MODERACAO'
      | 'ISOLATEUS_MODERACAO'
      | 'QLICK_OCIOSIDADE'
      | 'WOR_OCIOSIDADE'
      | 'ISOLATEUS_OCIOSIDADE',
  ): Promise<number> {
    const aluno = await this.alunoRepo.findById(alunoId);
    if (!aluno || aluno.turmaId !== turmaId || pontos <= 0) {
      return 0;
    }
    const db = this.firebase.firestore;
    const alunoRef = db.collection('alunos').doc(alunoId);
    const logRef = db.collection('xp_logs').doc();
    // Devolve (e registra) o que de fato saiu: o XP nunca fica negativo (032).
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(alunoRef);
      const atual = (snap.data()?.xpTotal as number | undefined) ?? 0;
      const debitado = Math.min(pontos, Math.max(0, atual));
      tx.update(alunoRef, { xpTotal: atual - debitado });
      tx.set(logRef, {
        alunoId,
        turmaId,
        pontos: -debitado,
        motivo,
        data: new Date().toISOString(),
      });
      return debitado;
    });
  }

  /**
   * Transfere XP de um aluno para outro da mesma turma (spec 032, denúncia
   * validada). Transferência REAL: sai do doador no máximo o que ele tem (o XP
   * nunca fica negativo) e o recebedor ganha exatamente isso, sem criar pontos.
   * `noMesmoCommit` deixa o chamador ler e gravar o próprio documento na mesma
   * transação (a denúncia não pode ser resolvida duas vezes). Devolve o valor
   * transferido.
   */
  async transferir(op: {
    turmaId: string;
    deAlunoId: string;
    paraAlunoId: string;
    pontos: number;
    motivo: string;
    noMesmoCommit?: {
      ler: (tx: Transaction) => Promise<void>;
      gravar: (tx: Transaction, transferido: number) => void;
    };
  }): Promise<number> {
    const extra = op.noMesmoCommit;
    const r = await this.transferirParaVarios({
      turmaId: op.turmaId,
      deAlunoId: op.deAlunoId,
      paraAlunoIds: [op.paraAlunoId],
      pontos: op.pontos,
      motivo: op.motivo,
      noMesmoCommit: extra && {
        ler: extra.ler,
        gravar: (tx, transferido) => extra.gravar(tx, transferido),
      },
    });
    return r.transferido;
  }

  /**
   * Transfere XP de um aluno para vários da mesma turma (spec 033, grupo de
   * denúncias validado). Sai do doador uma vez só, no máximo o que ele tem, e o
   * total é dividido igualmente entre os recebedores, com a sobra para os
   * primeiros da lista (`dividirIgual`). Nenhum ponto é criado nem perdido.
   * Um log de débito e um de crédito por recebedor com parte > 0.
   */
  async transferirParaVarios(op: {
    turmaId: string;
    deAlunoId: string;
    /** Na ordem de prioridade da sobra (spec 033: cronológica). */
    paraAlunoIds: string[];
    pontos: number;
    motivo: string;
    noMesmoCommit?: {
      ler: (tx: Transaction) => Promise<void>;
      gravar: (
        tx: Transaction,
        transferido: number,
        partes: Array<{ alunoId: string; pontos: number }>,
      ) => void;
    };
  }): Promise<{
    transferido: number;
    partes: Array<{ alunoId: string; pontos: number }>;
  }> {
    const para = [...new Set(op.paraAlunoIds)];
    if (para.length === 0 || para.includes(op.deAlunoId)) {
      throw new BadRequestException('Recebedores invalidos.');
    }
    for (const id of [op.deAlunoId, ...para]) {
      const aluno = await this.alunoRepo.findById(id);
      if (!aluno || aluno.turmaId !== op.turmaId) {
        throw new NotFoundException('Aluno nao encontrado.');
      }
    }
    const db = this.firebase.firestore;
    const deRef = db.collection('alunos').doc(op.deAlunoId);
    const paraRefs = para.map((id) => db.collection('alunos').doc(id));
    return db.runTransaction(async (tx) => {
      // Todas as leituras antes de qualquer escrita (regra do Firestore).
      await op.noMesmoCommit?.ler(tx);
      const de = await tx.get(deRef);
      const xpPara: number[] = [];
      for (const ref of paraRefs) {
        const snap = await tx.get(ref);
        xpPara.push((snap.data()?.xpTotal as number | undefined) ?? 0);
      }
      const xpDe = (de.data()?.xpTotal as number | undefined) ?? 0;
      const transferido = Math.max(0, Math.min(op.pontos, xpDe));
      const valores = dividirIgual(transferido, para.length);
      const partes = para.map((alunoId, i) => ({
        alunoId,
        pontos: valores[i],
      }));
      if (transferido > 0) {
        const data = new Date().toISOString();
        tx.update(deRef, { xpTotal: xpDe - transferido });
        tx.set(db.collection('xp_logs').doc(), {
          alunoId: op.deAlunoId,
          turmaId: op.turmaId,
          pontos: -transferido,
          motivo: op.motivo,
          data,
        });
        partes.forEach((p, i) => {
          if (p.pontos <= 0) return;
          tx.update(paraRefs[i], { xpTotal: xpPara[i] + p.pontos });
          tx.set(db.collection('xp_logs').doc(), {
            alunoId: p.alunoId,
            turmaId: op.turmaId,
            pontos: p.pontos,
            motivo: op.motivo,
            data,
          });
        });
      }
      op.noMesmoCommit?.gravar(tx, transferido, partes);
      return { transferido, partes };
    });
  }

  /**
   * Credita ao XP dos alunos os pontos de uma partida encerrada (Tichr Qlick ou
   * Wor, conforme `motivo`). O próprio jogo é a opção de gamificar (PhD), então
   * dispensa o gate de `pontuacaoAtiva`. Usa `increment` para somar sem corrida
   * com a base.
   */
  async creditarPartida(
    turmaId: string,
    pontosPorAluno: Array<{ alunoId: string; pontos: number }>,
    motivo: 'QLICK' | 'WOR' | 'ISOLATEUS' = 'QLICK',
  ): Promise<void> {
    const validos = pontosPorAluno.filter((p) => p.pontos > 0);
    if (validos.length === 0) {
      return;
    }
    const db = this.firebase.firestore;
    const batch = db.batch();
    for (const { alunoId, pontos } of validos) {
      const aluno = await this.alunoRepo.findById(alunoId);
      if (!aluno || aluno.turmaId !== turmaId) {
        continue;
      }
      batch.update(db.collection('alunos').doc(alunoId), {
        xpTotal: FieldValue.increment(pontos),
      });
      batch.set(db.collection('xp_logs').doc(), {
        alunoId,
        turmaId,
        pontos,
        motivo,
        data: new Date().toISOString(),
      });
    }
    await batch.commit();
  }
}
