/**
 * Backfill: marca `emailVerified: true` nas contas criadas ANTES do corte.
 *
 * Por que isto existe: o Tichr nunca enviou e-mail de verificacao, entao toda a
 * base existente esta `emailVerified: false` no Firebase Auth. Ligar a trava do
 * AuthGuard (Task 4) sem este passo tranca TODOS os professores atuais para fora
 * do proprio painel.
 *
 * Nao afrouxa nada: essas contas ja tem acesso pleno hoje. O que o script faz e
 * registrar no Auth o que ja e verdade na pratica, para que a trava valha so de
 * quem se cadastrar a partir de agora.
 *
 * A alternativa — isentar contas antigas por `creationTime` no proprio guard —
 * custaria um getUser por request (ou uma custom claim) e deixaria um ramo de
 * legado no codigo para sempre.
 *
 * ORDEM DE DEPLOY: rodar ANTES de subir o backend com a trava. Inverter tranca
 * a base inteira para fora.
 *
 * Uso (a partir do repo do BE, com FIREBASE_SERVICE_ACCOUNT no .env):
 *   npx ts-node scripts/marcar-emails-verificados.ts                 # dry-run
 *   npx ts-node scripts/marcar-emails-verificados.ts --aplicar       # escreve
 *   npx ts-node scripts/marcar-emails-verificados.ts --aplicar --corte=2026-07-20
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, UserRecord } from 'firebase-admin/auth';
import * as dotenv from 'dotenv';

dotenv.config();

/** Dry-run e o padrao: escrever exige --aplicar explicito. */
const APLICAR = process.argv.includes('--aplicar');

/** Contas criadas ate aqui sao consideradas legadas. Default: agora. */
function corte(): Date {
  const arg = process.argv.find((a) => a.startsWith('--corte='));
  if (!arg) return new Date();
  const data = new Date(arg.split('=')[1]);
  if (Number.isNaN(data.getTime())) {
    throw new Error(`--corte invalido: ${arg}. Use YYYY-MM-DD.`);
  }
  return data;
}

function inicializar(): void {
  if (getApps().length) return;
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!base64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT nao configurada.');
  }
  const serviceAccount = JSON.parse(
    Buffer.from(base64, 'base64').toString('utf8'),
  ) as Record<string, string>;
  initializeApp({ credential: cert(serviceAccount) });
}

async function main(): Promise<void> {
  inicializar();
  const auth = getAuth();
  const dataCorte = corte();

  console.log(`Corte: contas criadas antes de ${dataCorte.toISOString()}`);
  console.log(
    APLICAR ? 'Modo: APLICAR (escreve)' : 'Modo: dry-run (nao escreve)',
  );
  console.log('');

  let pageToken: string | undefined;
  let total = 0;
  let alvos = 0;
  let alterados = 0;

  do {
    const pagina = await auth.listUsers(1000, pageToken);
    pageToken = pagina.pageToken;

    const paraMarcar = pagina.users.filter((u: UserRecord) => {
      total++;
      if (u.emailVerified) return false; // ja verificado: nada a fazer
      if (!u.email) return false; // sem e-mail: nao se aplica
      return new Date(u.metadata.creationTime) < dataCorte;
    });

    alvos += paraMarcar.length;

    for (const user of paraMarcar) {
      console.log(`  ${APLICAR ? '[marcando]' : '[marcaria]'} ${user.email}`);
      if (APLICAR) {
        await auth.updateUser(user.uid, { emailVerified: true });
        alterados++;
      }
    }
  } while (pageToken);

  console.log('');
  console.log(`Usuarios inspecionados: ${total}`);
  console.log(`Alvos (nao verificados, anteriores ao corte): ${alvos}`);
  if (APLICAR) {
    console.log(`Marcados como verificados: ${alterados}`);
  } else {
    console.log('Nada foi escrito. Rode de novo com --aplicar para efetivar.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error('Falhou:', erro);
    process.exit(1);
  });
