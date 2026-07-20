import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

/** Limite default de gerações de IA por dia/jogo quando não há config salva. */
export const LIMITE_IA_DEFAULT = 1;
/** Teto de segurança do limite global (evita liberar geração sem freio). */
export const LIMITE_IA_MAX = 20;

/** Configuração global de IA exposta ao painel/serviços. */
export interface ConfigIaView {
  limiteGeracoesDia: number;
  atualizadoEm?: string;
}

/**
 * Configuração global da IA (doc `config/ia`). Hoje guarda só o **limite de
 * gerações por dia por jogo** — o admin sobe/desce e reflete na hora (os
 * `*IaService` leem no momento da geração; nada é cacheado).
 */
@Injectable()
export class ConfigIaService {
  constructor(private readonly firebase: FirebaseService) {}

  private get doc() {
    return this.firebase.firestore.collection('config').doc('ia');
  }

  async obter(): Promise<ConfigIaView> {
    const snap = await this.doc.get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    return {
      limiteGeracoesDia: this.sanear(data?.limiteGeracoesDia),
      atualizadoEm: data?.atualizadoEm as string | undefined,
    };
  }

  /** Só o número; usado pelos serviços de IA no enforcement. */
  async limiteGeracoesDia(): Promise<number> {
    return (await this.obter()).limiteGeracoesDia;
  }

  async definirLimite(valor: number): Promise<ConfigIaView> {
    const limite = Math.max(
      1,
      Math.min(LIMITE_IA_MAX, Math.floor(Number(valor))),
    );
    await this.doc.set(
      { limiteGeracoesDia: limite, atualizadoEm: new Date().toISOString() },
      { merge: true },
    );
    return this.obter();
  }

  private sanear(valor: unknown): number {
    const n = Number(valor);
    return Number.isInteger(n) && n >= 1 && n <= LIMITE_IA_MAX
      ? n
      : LIMITE_IA_DEFAULT;
  }
}
