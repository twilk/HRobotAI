import { IsIn } from 'class-validator'

/** `POST /zastepstwa/zapytania/:zapytanieId/odpowiedz` — akcja pracownika w aplikacji. */
export class OdpowiedzPracownikaDto {
  @IsIn(['TAK', 'NIE'])
  odpowiedz!: 'TAK' | 'NIE'
}
