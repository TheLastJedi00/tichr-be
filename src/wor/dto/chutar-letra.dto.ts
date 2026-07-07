import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/** Chuta uma letra e vota a ação da equipe (atacar um rival ou comprar dica). */
export class ChutarLetraDto {
  @IsString()
  @Length(1, 1)
  letra: string;

  @IsIn(['ATACAR', 'DICA'])
  acao: 'ATACAR' | 'DICA';

  /** Obrigatório quando `acao === 'ATACAR'`: id da equipe rival votada. */
  @IsOptional()
  @IsString()
  alvoEquipeId?: string;
}
