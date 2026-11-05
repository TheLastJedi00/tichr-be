import { BadRequestException } from '@nestjs/common';
import { DENUNCIA } from '../denuncia.constants';

/**
 * Tópico de denúncia criado pelo professor (spec 032 #6): vale para todas as
 * turmas dele e traz uma pontuação sugerida, editável na validação. Arquiva em
 * vez de apagar, porque as denúncias antigas citam o tópico.
 */
export class DenunciaTopicoEntity {
  id: string;
  professorId: string;
  titulo: string;
  pontosSugeridos: number;
  ativo = true;
  criadoEm: string;

  constructor(partial: Partial<DenunciaTopicoEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Normaliza e valida título e pontos (criação e edição). */
  static validar(dados: { titulo?: string; pontosSugeridos?: number }): {
    titulo?: string;
    pontosSugeridos?: number;
  } {
    const out: { titulo?: string; pontosSugeridos?: number } = {};
    if (dados.titulo !== undefined) {
      const titulo = dados.titulo.trim();
      if (titulo.length < 3 || titulo.length > 80) {
        throw new BadRequestException(
          'O tópico precisa ter de 3 a 80 caracteres.',
        );
      }
      out.titulo = titulo;
    }
    if (dados.pontosSugeridos !== undefined) {
      out.pontosSugeridos = DenunciaTopicoEntity.pontosValidos(
        dados.pontosSugeridos,
      );
    }
    return out;
  }

  static pontosValidos(pontos: number): number {
    if (
      !Number.isInteger(pontos) ||
      pontos < 0 ||
      pontos > DENUNCIA.TETO_PONTOS
    ) {
      throw new BadRequestException({
        code: 'PONTOS_INVALIDOS',
        message: `A pontuação vai de 0 a ${DENUNCIA.TETO_PONTOS}.`,
      });
    }
    return pontos;
  }
}
