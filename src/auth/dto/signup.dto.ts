import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { PlanoAtual } from '../../professor/entities/professor.entity';

/**
 * Cadastro: nome + e-mail + senha, com aceite obrigatorio dos documentos legais
 * (Termos de Uso e Politica de Privacidade). O aceite e exigido tambem no
 * servidor (defesa em profundidade) e registrado no perfil para conformidade LGPD.
 */
export class SignupDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome.' })
  @MaxLength(80)
  nome: string;

  @IsEmail({}, { message: 'Informe um e-mail valido.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter ao menos 6 caracteres.' })
  password: string;

  @IsBoolean()
  @Equals(true, { message: 'E preciso aceitar os Termos de Uso.' })
  aceiteTermos: boolean;

  @IsBoolean()
  @Equals(true, { message: 'E preciso aceitar a Politica de Privacidade.' })
  aceitePrivacidade: boolean;

  /**
   * Plano escolhido na vitrine/cadastro. A conta nasce ESTAGIARIO; se este for um
   * plano pago, fica registrado como **plano pretendido** para levar ao checkout
   * apos a confirmacao do e-mail (fonte de verdade no servidor).
   */
  @IsOptional()
  @IsIn(['ESTAGIARIO', 'GRADUADO', 'MESTRE', 'PHD'])
  planoPretendido?: PlanoAtual;
}
