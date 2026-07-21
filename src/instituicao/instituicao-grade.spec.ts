import { InstituicaoEntity } from './entities/instituicao.entity';

describe('InstituicaoEntity.gerarGrade', () => {
  it('gera horarios contiguos com intervalo na fronteira de slot', () => {
    const inst = new InstituicaoEntity({
      nome: 'Escola Teste',
      inicioPrimeiroPeriodo: '07:00',
      fimUltimoPeriodo: '12:00',
      duracaoAula: 50,
      inicioIntervalo: '09:30',
      duracaoIntervalo: 20,
    });

    const grade = inst.gerarGrade();
    const aulas = grade.filter((s) => s.tipo === 'AULA');
    const intervalos = grade.filter((s) => s.tipo === 'INTERVALO');

    // 07:00,07:50,08:40 (3) -> intervalo 09:30-09:50 -> 09:50,10:40 (2).
    // A 6a aula (11:30-12:20) passaria de 12:00, entao para em 5.
    expect(aulas).toHaveLength(5);
    expect(intervalos).toHaveLength(1);

    // Numeracao sequencial so das aulas, ignorando o intervalo.
    expect(aulas.map((a) => a.periodo)).toEqual([1, 2, 3, 4, 5]);
    expect(aulas[0]).toMatchObject({ horaInicio: '07:00', horaFim: '07:50' });
    expect(aulas[0].rotulo).toBe('1º Horário');

    // Intervalo entra na fronteira do slot >= 09:30 (depois do 3º horario).
    const intervalo = intervalos[0];
    expect(intervalo).toMatchObject({ horaInicio: '09:30', horaFim: '09:50' });
    const idxIntervalo = grade.indexOf(intervalo);
    expect(grade[idxIntervalo - 1].periodo).toBe(3);
    expect(grade[idxIntervalo + 1]).toMatchObject({
      periodo: 4,
      horaInicio: '09:50',
    });
  });

  it('nao ultrapassa o fim do ultimo periodo', () => {
    const inst = new InstituicaoEntity({
      nome: 'X',
      inicioPrimeiroPeriodo: '08:00',
      fimUltimoPeriodo: '10:20',
      duracaoAula: 45,
    });
    const grade = inst.gerarGrade();
    // 08:00,08:45,09:30 (fim 10:15). Proxima (10:15+45=11:00) passa de 10:20.
    expect(grade).toHaveLength(3);
    expect(grade[grade.length - 1].horaFim).toBe('10:15');
    expect(grade.every((s) => s.horaFim <= '10:20')).toBe(true);
  });

  it('insere multiplos intervalos, cada um na sua fronteira', () => {
    const inst = new InstituicaoEntity({
      nome: 'Dois recreios',
      inicioPrimeiroPeriodo: '07:00',
      fimUltimoPeriodo: '12:00',
      duracaoAula: 50,
      intervalos: [
        { inicio: '08:40', duracao: 15 },
        { inicio: '10:30', duracao: 10 },
      ],
    });
    const grade = inst.gerarGrade();
    const intervalos = grade.filter((s) => s.tipo === 'INTERVALO');
    expect(intervalos).toHaveLength(2);
    // 07:00,07:50 -> intervalo 08:40-08:55 -> 08:55,09:45 -> intervalo 10:35-10:45 ...
    expect(intervalos[0]).toMatchObject({ horaInicio: '08:40', horaFim: '08:55' });
    expect(intervalos[1].tipo).toBe('INTERVALO');
    // Numeracao das aulas ignora os dois intervalos.
    const aulas = grade.filter((s) => s.tipo === 'AULA');
    expect(aulas.map((a) => a.periodo)).toEqual(
      aulas.map((_, i) => i + 1),
    );
  });

  it('cai no intervalo legado (campo unico) quando nao ha lista', () => {
    const inst = new InstituicaoEntity({
      nome: 'Legado',
      inicioPrimeiroPeriodo: '07:00',
      fimUltimoPeriodo: '10:00',
      duracaoAula: 50,
      inicioIntervalo: '08:40',
      duracaoIntervalo: 20,
    });
    const grade = inst.gerarGrade();
    expect(grade.filter((s) => s.tipo === 'INTERVALO')).toHaveLength(1);
  });

  it('funciona sem intervalo configurado', () => {
    const inst = new InstituicaoEntity({
      nome: 'Sem recreio',
      inicioPrimeiroPeriodo: '13:00',
      fimUltimoPeriodo: '14:30',
      duracaoAula: 45,
    });
    const grade = inst.gerarGrade();
    expect(grade).toHaveLength(2);
    expect(grade.every((s) => s.tipo === 'AULA')).toBe(true);
  });

  it('retorna vazio para parametros invalidos (fim antes do inicio)', () => {
    const inst = new InstituicaoEntity({
      nome: 'Ruim',
      inicioPrimeiroPeriodo: '10:00',
      fimUltimoPeriodo: '09:00',
      duracaoAula: 50,
    });
    expect(inst.gerarGrade()).toEqual([]);
  });
});
