import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { RtdbService } from '../firebase/rtdb.service';
import { CENA, Passo, posicaoEm } from './isolateus-cena';

/**
 * O canal de posição cosmética (spec 034). Só o backend escreve em
 * `pos/{partidaId}/{setorId}/{habitanteId} = { x, alvoX, t }`; os celulares só
 * leem, com um custom token restrito ao setor. Reais e NPCs gravam pelo MESMO
 * caminho e no MESMO formato: ninguém distingue um do outro pelo canal.
 */
@Injectable()
export class IsolateusPosicaoService {
  constructor(
    private readonly rtdb: RtdbService,
    private readonly firebase: FirebaseService,
  ) {}

  get habilitado(): boolean {
    return this.rtdb.habilitado;
  }

  private caminho(partidaId: string, setorId: string, habitanteId?: string) {
    return ['pos', partidaId, setorId, habitanteId].filter(Boolean).join('/');
  }

  /**
   * Grava a caminhada de `habitanteId` até `alvoX`. O `x` de saída é calculado
   * aqui (último passo + velocidade fixa): o cliente nunca manda a própria
   * posição. `limitar` aplica o 1 passo por segundo (só para alunos; a
   * cadência do NPC é sorteada).
   */
  async passo(
    partidaId: string,
    setorId: string,
    habitanteId: string,
    alvoX: number,
    opts: { limitar: boolean },
    agora: number = Date.now(),
  ): Promise<Passo> {
    const caminho = this.caminho(partidaId, setorId, habitanteId);
    const ultimo = await this.rtdb.ler<Passo>(caminho);
    if (opts.limitar && ultimo && agora - ultimo.t < CENA.PASSO_INTERVALO_MS) {
      throw new HttpException(
        { code: 'PASSO_RAPIDO', message: 'Calma! Um passo por segundo.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const x = ultimo ? posicaoEm(ultimo, agora) : CENA.X_INICIAL;
    const novo: Passo = { x, alvoX, t: agora };
    await this.rtdb.gravar(caminho, novo);
    return novo;
  }

  /** Custom token que só enxerga `pos/{partidaId}/{setorId}`. */
  async token(
    partidaId: string,
    setorId: string,
    alunoId: string,
  ): Promise<string> {
    return this.firebase.auth.createCustomToken(
      `isolateus:${partidaId}:${alunoId}`,
      { partidaId, setorId },
    );
  }

  /** Fim da partida: apaga todas as posições. */
  async limpar(partidaId: string): Promise<void> {
    if (!this.habilitado) return;
    await this.rtdb.apagar(`pos/${partidaId}`);
  }
}
