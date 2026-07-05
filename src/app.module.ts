import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FirebaseModule } from './firebase/firebase.module';
import { AuthModule } from './auth/auth.module';
import { TurmaModule } from './turma/turma.module';
import { ProfessorModule } from './professor/professor.module';
import { PlanoAulaModule } from './plano-aula/plano-aula.module';
import { QlickModule } from './qlick/qlick.module';
import { HomeModule } from './home/home.module';
import { AdminModule } from './admin/admin.module';
import { CupomModule } from './cupom/cupom.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    FirebaseModule,
    AuthModule,
    TurmaModule,
    ProfessorModule,
    PlanoAulaModule,
    QlickModule,
    HomeModule,
    AdminModule,
    CupomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
