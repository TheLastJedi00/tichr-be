import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { GeminiService } from './gemini.service';
import { GerarDicasDto } from './dto/gerar-dicas.dto';

/**
 * Orquestra a geração de dicas por IA com **rate limit de 1×/dia por professor**
 * (a spec restringe por infraestrutura). Dicas manuais seguem sempre disponíveis.
 */
@Injectable()
export class WorIaService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly professores: ProfessorService,
  ) {}

  async gerarDicas(uid: string, dto: GerarDicasDto): Promise<{ dicas: string[] }> {
    if (!this.gemini.disponivel()) {
      throw new ServiceUnavailableException({
        code: 'IA_INDISPONIVEL',
        message: 'Geração por IA indisponível. Você pode escrever as dicas manualmente.',
      });
    }

    const hoje = new Date().toISOString().slice(0, 10);
    const prof = await this.professores.getProfile(uid);
    if (prof.usouIaWorHoje(hoje)) {
      throw new HttpException(
        {
          code: 'IA_RATE_LIMIT',
          message:
            'Sua magia diária se esgotou! Para manter a performance, a IA gera dicas 1 vez por dia. Escreva suas próprias dicas abaixo, ou volte amanhã.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const dicas = await this.gemini.gerarDicas(
      dto.topico,
      dto.palavra,
      dto.disciplina,
    );
    // Só consome a cota diária quando a IA respondeu com sucesso.
    await this.professores.marcarUsoIaWor(uid);
    return { dicas };
  }
}
