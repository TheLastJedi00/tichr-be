import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { IsolateusMatchEntity } from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';

/** Por quanto tempo após a criação a partida continua "de hoje" para o aluno. */
const JANELA_VISIBILIDADE_MS = 12 * 60 * 60 * 1000; // 12h

/** Uma resposta de aluno a uma questão da rodada. */
export interface RespostaIsolateus {
  alunoId: string;
  alternativaIndex: number;
  correta: boolean;
  pontos: number;
}

/**
 * Estado da partida em DUAS coleções, por segurança (§11.3):
 * - `isolateus_partidas/{id}` — camada pública, lida pelo cliente via `onSnapshot`.
 * - `isolateus_segredos/{id}` — o cofre (Alien, NPCs, ação da rodada), fechado.
 *
 * As duas são escritas no MESMO batch, para que o estado nunca fique meio-passo
 * fora de sincronia entre o que a vila vê e o que o servidor sabe.
 */
@Injectable()
export class IsolateusMatchRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get col() {
    return this.firebase.firestore.collection('isolateus_partidas');
  }
  private get cofre() {
    return this.firebase.firestore.collection('isolateus_segredos');
  }
  private get respostas() {
    return this.firebase.firestore.collection('isolateus_respostas');
  }
  private get votos() {
    return this.firebase.firestore.collection('isolateus_votos');
  }
  private semId<T extends { id?: string }>(data: T): Omit<T, 'id'> {
    const plain = { ...data };
    delete plain.id;
    return plain;
  }

  // --- Partida (público) ---

  async criar(
    partida: Partial<IsolateusMatchEntity>,
    segredo: Partial<IsolateusSegredoEntity>,
  ): Promise<IsolateusMatchEntity> {
    const ref = this.col.doc();
    const batch = this.firebase.firestore.batch();
    batch.set(ref, this.semId(partida as IsolateusMatchEntity));
    batch.set(this.cofre.doc(ref.id), {
      ...this.semId(segredo as IsolateusSegredoEntity),
      partidaId: ref.id,
    });
    await batch.commit();
    return plainToInstance(IsolateusMatchEntity, { ...partida, id: ref.id });
  }

  async buscar(id: string): Promise<IsolateusMatchEntity | null> {
    const snap = await this.col.doc(id).get();
    return snap.exists
      ? plainToInstance(IsolateusMatchEntity, { ...snap.data(), id: snap.id })
      : null;
  }

  async buscarSegredo(id: string): Promise<IsolateusSegredoEntity | null> {
    const snap = await this.cofre.doc(id).get();
    return snap.exists
      ? plainToInstance(IsolateusSegredoEntity, { ...snap.data(), id: snap.id })
      : null;
  }

  /**
   * Grava a camada pública e o cofre num ÚNICO commit. Toda mutação de estado do
   * jogo passa por aqui — é o que garante que a vila nunca veja um alerta cuja
   * ação ainda não foi registrada no cofre (ou o contrário).
   */
  async commitPartida(
    partidaId: string,
    publico: Partial<IsolateusMatchEntity>,
    segredo: Partial<IsolateusSegredoEntity> = {},
  ): Promise<void> {
    const batch = this.firebase.firestore.batch();
    if (Object.keys(publico).length) {
      batch.set(this.col.doc(partidaId), this.semId({ ...publico }), {
        merge: true,
      });
    }
    if (Object.keys(segredo).length) {
      batch.set(this.cofre.doc(partidaId), this.semId({ ...segredo }), {
        merge: true,
      });
    }
    await batch.commit();
  }

  /**
   * Partida não encerrada mais recente de uma turma, criada há pouco (janela de
   * 12h). O gatilho é o professor ter rodado — não depende do relógio do
   * servidor. Espelha o Qlick e o Wor.
   */
  async ativaDaTurma(turmaId: string): Promise<IsolateusMatchEntity | null> {
    const limite = Date.now() - JANELA_VISIBILIDADE_MS;
    const snap = await this.col.where('turmaId', '==', turmaId).get();
    const ativas = snap.docs
      .map((d) =>
        plainToInstance(IsolateusMatchEntity, { ...d.data(), id: d.id }),
      )
      .filter((m) => m.status !== 'ENCERRADO')
      .filter((m) => !m.criadaEm || Date.parse(m.criadaEm) >= limite)
      .sort((a, b) => (b.criadaEm ?? '').localeCompare(a.criadaEm ?? ''));
    return ativas[0] ?? null;
  }

  // --- Respostas (doc-id determinístico = idempotência) ---

  /** Registra a resposta; `false` se o aluno já havia respondido esta rodada. */
  async registrarResposta(
    partidaId: string,
    rodada: number,
    resposta: RespostaIsolateus,
  ): Promise<boolean> {
    const ref = this.respostas.doc(
      `${partidaId}_${rodada}_${resposta.alunoId}`,
    );
    if ((await ref.get()).exists) return false;
    await ref.set({ partidaId, rodada, ...resposta });
    return true;
  }

  /** Respostas de uma rodada (query só por partidaId; filtra a rodada em memória). */
  async lerRespostas(
    partidaId: string,
    rodada: number,
  ): Promise<RespostaIsolateus[]> {
    const snap = await this.respostas
      .where('partidaId', '==', partidaId)
      .get();
    return snap.docs
      .map((d) => d.data())
      .filter((r) => r.rodada === rodada)
      .map((r) => ({
        alunoId: r.alunoId as string,
        alternativaIndex: r.alternativaIndex as number,
        correta: r.correta as boolean,
        pontos: r.pontos as number,
      }));
  }

  // --- Votos da Quarentena (um por aluno POR RODADA; doc-id determinístico) ---

  /** Registra o voto; `false` se o aluno já havia votado nesta rodada. */
  async registrarVoto(
    partidaId: string,
    rodada: number,
    alunoId: string,
    suspeitoId: string,
  ): Promise<boolean> {
    const ref = this.votos.doc(`${partidaId}_${rodada}_${alunoId}`);
    if ((await ref.get()).exists) return false;
    await ref.set({ partidaId, rodada, alunoId, suspeitoId });
    return true;
  }

  /** Votos de uma rodada (query só por partidaId; filtra a rodada em memória). */
  async lerVotos(
    partidaId: string,
    rodada: number,
  ): Promise<Array<{ alunoId: string; suspeitoId: string }>> {
    const snap = await this.votos.where('partidaId', '==', partidaId).get();
    return snap.docs
      .map((d) => d.data())
      .filter((v) => v.rodada === rodada)
      .map((v) => ({
        alunoId: v.alunoId as string,
        suspeitoId: v.suspeitoId as string,
      }));
  }
}
