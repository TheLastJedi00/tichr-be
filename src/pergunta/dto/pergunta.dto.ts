import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PERGUNTA } from '../pergunta.constants';
import type { StatusPergunta } from '../entities/pergunta.entity';

/**
 * Multipart (com o `arquivo` opcional) ou JSON. O aluno e a turma saem do JWT,
 * nunca daqui. Título vazio e texto vazio são recusados pela entidade, com
 * código próprio.
 */
export class CriarPerguntaDto {
  @IsString()
  @MaxLength(PERGUNTA.TITULO_MAX)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(PERGUNTA.TEXTO_MAX)
  texto?: string;
}

export class MensagemPerguntaDto {
  @IsOptional()
  @IsString()
  @MaxLength(PERGUNTA.TEXTO_MAX)
  texto?: string;
}

/** O professor responde só em texto (037 #12). */
export class RespostaProfessorDto {
  @IsString()
  @MaxLength(PERGUNTA.TEXTO_MAX)
  texto: string;
}

export class ListarPerguntasQuery {
  @IsOptional()
  @IsIn(['ABERTA', 'ENCERRADA'])
  status?: StatusPergunta;
}
