import { plainToInstance } from 'class-transformer';
import { IsolateusMatchEntity } from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Fix: o XP do Isolateus entrava multiplicado no ranking da turma.
 *
 * Todo celular cobra o `/tempo` quando o relógio zera. Na última fase, cada
 * cobrança lia a partida ainda aberta e chamava o encerramento — que creditava
 * o placar inteiro de novo. Com N celulares, o XP entrava N vezes. O
 * encerramento agora é reivindicado numa transação: só um fecha e credita.
 */
function comLeiturasDoBanco(v: ReturnType<typeof vilaComAmeacas>) {
  // Cada requisição lê o seu próprio retrato do banco (como no Firestore), e
  // não o mesmo objeto em memória: é isso que deixa as cobranças correrem.
  const copia = <T>(cls: new () => T, o: object): T =>
    plainToInstance(cls, JSON.parse(JSON.stringify(o)));
  (v.repo.buscar as jest.Mock).mockImplementation(async () =>
    copia(IsolateusMatchEntity, v.partida),
  );
  (v.repo.buscarSegredo as jest.Mock).mockImplementation(async () =>
    copia(IsolateusSegredoEntity, v.segredo),
  );
}

describe('Isolateus — encerramento credita o XP uma vez só', () => {
  it('várias cobranças simultâneas do fim creditam o placar uma única vez', async () => {
    const v = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 5 });
    v.segredo.pontos = { a3: 1200, a4: 1000 };
    comLeiturasDoBanco(v);

    await Promise.all([
      v.service.encerrarPeloProfessor('prof', 'p1'),
      v.service.encerrarPeloProfessor('prof', 'p1'),
      v.service.encerrarPeloProfessor('prof', 'p1'),
    ]);

    expect(v.partida.status).toBe('ENCERRADO');
    expect(v.creditar).toHaveBeenCalledTimes(1);
    const creditos = v.creditar.mock.calls[0][1] as Array<{
      alunoId: string;
      pontos: number;
    }>;
    expect(creditos.find((c) => c.alunoId === 'a3')?.pontos).toBe(1200);
    expect(creditos.find((c) => c.alunoId === 'a4')?.pontos).toBe(1000);
  });

  it('o placar final usa os pontos do cofre no fechamento, não os da leitura', async () => {
    const v = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 5 });
    v.segredo.pontos = { a3: 1000 };
    comLeiturasDoBanco(v);
    // Um acerto creditado depois da leitura do comando de encerrar.
    (v.repo.buscarSegredo as jest.Mock).mockImplementationOnce(async () => {
      const lido = plainToInstance(
        IsolateusSegredoEntity,
        JSON.parse(JSON.stringify(v.segredo)),
      );
      v.segredo.pontos = { a3: 2400 };
      return lido;
    });

    await v.service.encerrarPeloProfessor('prof', 'p1');

    const a3 = v.partida.rankingFinal.find((p) => p.alunoId === 'a3')!;
    expect(a3.pontos).toBe(2400);
    expect(v.creditar.mock.calls[0][1]).toContainEqual({
      alunoId: 'a3',
      pontos: 2400,
    });
  });

  it('respostas simultâneas não apagam os pontos uma da outra', async () => {
    const v = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 5 });
    comLeiturasDoBanco(v);

    await Promise.all([
      v.service.responder('a3', 'p1', 1),
      v.service.responder('a4', 'p1', 1),
    ]);

    expect(v.segredo.pontos?.a3).toBeGreaterThanOrEqual(1000);
    expect(v.segredo.pontos?.a4).toBeGreaterThanOrEqual(1000);
    expect(v.segredo.logPontos?.a3).toHaveLength(1);
    expect(v.segredo.logPontos?.a4).toHaveLength(1);
  });
});
