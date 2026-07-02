import { Injectable } from '@nestjs/common';
import { AlunoEntity } from './entities/aluno.entity';

export interface MembroSquad {
  alunoId: string;
  nome: string;
  papel?: string;
}

export interface Squad {
  numero: number;
  tema?: string;
  membros: MembroSquad[];
}

/**
 * Motor de agrupamento de alunos para dinamicas em sala.
 * Embaralha (Fisher-Yates), distribui em N equipes de tamanho similar,
 * atribui papeis sequencialmente e sorteia um tema por equipe.
 */
@Injectable()
export class AgrupamentoService {
  sortear(
    alunos: AlunoEntity[],
    numeroEquipes: number,
    papeis: string[] = [],
    temas: string[] = [],
  ): Squad[] {
    const n = Math.max(1, Math.floor(numeroEquipes));
    const embaralhados = this.embaralhar(alunos);
    const temasSorteados = this.embaralhar(temas);

    const squads: Squad[] = Array.from({ length: n }, (_, i) => ({
      numero: i + 1,
      tema: temas.length ? temasSorteados[i % temasSorteados.length] : undefined,
      membros: [],
    }));

    // Distribuicao round-robin garante equipes de tamanho similar (diferenca <= 1).
    embaralhados.forEach((aluno, idx) => {
      const squad = squads[idx % n];
      const papel = papeis.length
        ? papeis[squad.membros.length % papeis.length]
        : undefined;
      squad.membros.push({ alunoId: aluno.id, nome: aluno.nome, papel });
    });

    return squads;
  }

  /** Embaralhamento Fisher-Yates sobre uma copia do array. */
  private embaralhar<T>(itens: T[]): T[] {
    const copia = [...itens];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }
}
