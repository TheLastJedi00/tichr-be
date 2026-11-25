import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Formato só. Limites, prazo com hora e faixa de valores são da entidade, que
 * responde com código próprio (TITULO_INVALIDO, PRAZO_INVALIDO...).
 */
export class CriarAtividadeDto {
  // Opcionais aqui de propósito: ausentes, a entidade responde com
  // TITULO_INVALIDO / PRAZO_OBRIGATORIO em vez do erro genérico do pipe.
  @IsOptional()
  @IsString()
  titulo?: string;

  @IsOptional()
  @IsString()
  descricao?: string | null;

  /** ISO com data e hora limite (038 #2). */
  @IsOptional()
  @IsString()
  prazo?: string;

  @IsOptional()
  @IsInt()
  valorPontos?: number;
}

export class EditarAtividadeDto {
  @IsOptional()
  @IsString()
  titulo?: string;

  @IsOptional()
  @IsString()
  descricao?: string | null;

  @IsOptional()
  @IsString()
  prazo?: string;

  @IsOptional()
  @IsInt()
  valorPontos?: number;
}

/** O canva do aluno (038 #8): o aluno e a turma saem do JWT. */
export class TextoEntregaDto {
  @IsString()
  texto: string;
}

export class AvaliarEntregaDto {
  @IsNumber()
  nota: number;

  @IsOptional()
  @IsString()
  comentario?: string | null;
}
