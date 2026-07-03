import { ForbiddenException, Injectable } from '@nestjs/common';
import { ProfessorService } from '../professor/professor.service';
import { TopicoEntity } from './entities/topico.entity';
import { AlocacaoRepository } from './alocacao.repository';
import { TopicoRepository } from './topico.repository';

@Injectable()
export class TopicoService {
  constructor(
    private readonly topicoRepo: TopicoRepository,
    private readonly alocacaoRepo: AlocacaoRepository,
    private readonly professorService: ProfessorService,
  ) {}

  private async assertMestre(professorId: string): Promise<void> {
    const professor = await this.professorService.getProfile(professorId);
    if (!professor.atendePlano('MESTRE')) {
      throw new ForbiddenException({
        code: 'PLANO_LOCKED',
        message: 'A gestão de tópicos exige o plano Mestre ou superior.',
        minimo: 'MESTRE',
      });
    }
  }

  async listar(
    professorId: string,
    disciplina: string,
  ): Promise<TopicoEntity[]> {
    await this.assertMestre(professorId);
    return this.topicoRepo.findByDisciplina(professorId, disciplina);
  }

  /** Cadastra tópicos em lote (ignora vazios/duplicados na disciplina). */
  async adicionar(
    professorId: string,
    disciplina: string,
    nomes: string[],
  ): Promise<TopicoEntity[]> {
    await this.assertMestre(professorId);
    const disc = disciplina.trim();
    const existentes = new Set(
      (await this.topicoRepo.findByDisciplina(professorId, disc)).map(
        (t) => t.nome,
      ),
    );
    const limpos = [
      ...new Set(nomes.map((n) => n.trim()).filter((n) => n.length > 0)),
    ].filter((n) => !existentes.has(n));

    return Promise.all(
      limpos.map((nome) =>
        this.topicoRepo.create(
          new TopicoEntity({ professorId, disciplina: disc, nome }),
        ),
      ),
    );
  }

  /** Remove o tópico e limpa suas alocações. */
  async remover(
    professorId: string,
    topicoId: string,
  ): Promise<{ removido: boolean }> {
    await this.assertMestre(professorId);
    await this.alocacaoRepo.deleteByTopico(topicoId);
    await this.topicoRepo.delete(topicoId);
    return { removido: true };
  }
}
