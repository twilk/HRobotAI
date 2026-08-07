import { Injectable, Logger } from '@nestjs/common'

/** Kształt 1:1 z `grafik-optimizer/app/ranking.py` (`RankingZastepstwaRequest`/`Response`). */
export interface RankingKandydatInput {
  pracownikId: string
  dostepny: boolean
  wykonalnaZamiana: boolean
  powodNiewykonalnosci?: string | null
  obciazenieTygodnioweGodz: number
  limitTygodniowyGodz?: number
  dniOdOstatniegoZastepstwa?: number | null
  preferencjaPriorytet?: number
}

export interface RankingWagi {
  obciazenie?: number
  rotacja?: number
  preferencje?: number
  dostepnosc?: number
}

export interface RankingPozycja {
  pracownikId: string
  wynik: number
  uzasadnienie: string[]
}

/** Port do `grafik-optimizer` `POST /ranking/zastepstwa` — seam do testów bez żywego serwisu Pythona. */
export interface RankingClient {
  rankuj(
    shiftId: string,
    nieobecnyId: string,
    kandydaci: RankingKandydatInput[],
    wagi?: RankingWagi,
  ): Promise<RankingPozycja[]>
}

export const RANKING_CLIENT = Symbol('RANKING_CLIENT')

/** Compose-service default; nadpisywalny przez `OPTIMIZER_URL` (ta sama zmienna co `shift-swap`). */
export const DEFAULT_OPTIMIZER_URL = 'http://optimizer:8000'

@Injectable()
export class HttpRankingClient implements RankingClient {
  private readonly logger = new Logger(HttpRankingClient.name)
  private readonly baseUrl: string = process.env.OPTIMIZER_URL ?? DEFAULT_OPTIMIZER_URL

  async rankuj(
    shiftId: string,
    nieobecnyId: string,
    kandydaci: RankingKandydatInput[],
    wagi?: RankingWagi,
  ): Promise<RankingPozycja[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/ranking/zastepstwa`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shiftId, nieobecnyId, kandydaci, wagi: wagi ?? {} }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      this.logger.error(`Ranking /ranking/zastepstwa failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
      throw new Error(`Ranking service returned HTTP ${res.status}`)
    }
    const body = (await res.json()) as { ranking: RankingPozycja[] }
    return body.ranking
  }
}
