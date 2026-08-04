import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator'

export class KandydatZapytaniaDto {
  @IsString()
  pracownikId!: string

  @IsBoolean()
  dostepny!: boolean

  @IsBoolean()
  wykonalnaZamiana!: boolean

  @IsOptional()
  @IsString()
  powodNiewykonalnosci?: string

  @IsNumber()
  @Min(0)
  obciazenieTygodnioweGodz!: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitTygodniowyGodz?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  dniOdOstatniegoZastepstwa?: number

  @IsOptional()
  @IsNumber()
  preferencjaPriorytet?: number
}

/** `POST /zastepstwa` — start orkiestracji kontaktu dla nieobecności na zmianie `shiftId`. */
export class RozpocznijPoszukiwanieDto {
  @IsString()
  shiftId!: string

  @IsString()
  nieobecnyId!: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => KandydatZapytaniaDto)
  kandydaci!: KandydatZapytaniaDto[]

  @IsOptional()
  wagi?: { obciazenie?: number; rotacja?: number; preferencje?: number; dostepnosc?: number }

  /** Ile minut kandydat ma na odpowiedź, zanim system przejdzie do następnego. Domyślnie 30. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  terminMinut?: number
}
