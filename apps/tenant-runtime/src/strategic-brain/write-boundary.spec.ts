import { readdirSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'

/**
 * [M13] Art. 22 RODO — twarda granica zapisu.
 *
 * `strategic-brain` analizuje i REKOMENDUJE; nigdy nie wykonuje akcji kadrowej. Ten test jest
 * statyczną analizą (bez DI/runtime): skanuje KAŻDY plik `.ts` w tym module (poza `*.spec.ts`)
 * i fail'uje, jeśli którykolwiek plik wywołuje write Prisma (`.create/.createMany/.update/
 * .updateMany/.delete/.deleteMany/.upsert`) na modelu spoza własnych tabel modułu.
 *
 * Zakazane modele (personnel/shift/proposal state — moduł nigdy tego nie mutuje):
 *   employee, shift, shiftDemand, aiProposal, aiProposalCandidate, leaveRequest, user, userRole,
 *   accessGrant.
 *
 * Dozwolone są WYŁĄCZNIE zapisy do własnych tabel modułu:
 *   employeePerformanceSnapshot, recruitmentRecommendation, performanceConfig, workOrder,
 *   complaint (dwa ostatnie tylko w ścieżce seed, ale dopuszczone w skanie źródeł).
 *
 * Odczyty (findMany/findFirst/findUnique/aggregate/$queryRaw) na DOWOLNYM modelu są OK — ten
 * guard dotyczy wyłącznie zapisów do stanu kadrowego/grafikowego.
 */

const MODULE_DIR = __dirname

const FORBIDDEN_MODELS = [
  'employee',
  'shift',
  'shiftDemand',
  'aiProposal',
  'aiProposalCandidate',
  'leaveRequest',
  'user',
  'userRole',
  'accessGrant',
] as const

const ALLOWED_MODELS = [
  'employeePerformanceSnapshot',
  'recruitmentRecommendation',
  'performanceConfig',
  'workOrder',
  'complaint',
] as const

const WRITE_METHODS = ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'] as const

/** Recursively collect every `.ts` source file under `dir`, excluding `*.spec.ts` test files. */
function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }
    if (extname(entry) !== '.ts') continue
    if (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts')) continue
    files.push(fullPath)
  }
  return files
}

/**
 * Build a regex matching `.<model>.<writeMethod>(`, tolerant of whitespace/newlines between the
 * dots and the method name (e.g. `client\n  .employee\n  .update(`).
 */
function buildWriteRegex(model: string, method: string): RegExp {
  return new RegExp(`\\.\\s*${model}\\s*\\.\\s*${method}\\s*\\(`, 'g')
}

interface Violation {
  file: string
  model: string
  method: string
  match: string
}

function scanForForbiddenWrites(files: string[]): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const model of FORBIDDEN_MODELS) {
      for (const method of WRITE_METHODS) {
        const regex = buildWriteRegex(model, method)
        const matches = text.match(regex)
        if (matches) {
          for (const match of matches) {
            violations.push({ file, model, method, match })
          }
        }
      }
    }
  }
  return violations
}

function scanForAllowedWrites(files: string[]): Violation[] {
  const found: Violation[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const model of ALLOWED_MODELS) {
      for (const method of WRITE_METHODS) {
        const regex = buildWriteRegex(model, method)
        const matches = text.match(regex)
        if (matches) {
          for (const match of matches) {
            found.push({ file, model, method, match })
          }
        }
      }
    }
  }
  return found
}

describe('strategic-brain write boundary (RODO art. 22 — M13)', () => {
  const sourceFiles = collectSourceFiles(MODULE_DIR)

  it('scans at least one non-spec source file (sanity: the module has code to guard)', () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  it('never performs a Prisma write on a forbidden personnel/shift/proposal model', () => {
    const violations = scanForForbiddenWrites(sourceFiles)

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  - ${v.file}: forbidden write "${v.match.trim()}" (model="${v.model}", method="${v.method}")`)
        .join('\n')
      throw new Error(
        `strategic-brain module contains ${violations.length} forbidden personnel-state write(s) — ` +
          `this violates the RODO art. 22 boundary (module may only analyze+recommend, never execute a ` +
          `personnel action):\n${report}`,
      )
    }

    expect(violations).toEqual([])
  })

  it('DOES write to its own tables (positive control — proves the scan is not vacuously passing)', () => {
    const allowedWrites = scanForAllowedWrites(sourceFiles)

    // sanity: the scan mechanism actually detects real write call-sites in this codebase
    expect(allowedWrites.length).toBeGreaterThan(0)

    // specifically: employeePerformanceSnapshot.upsert must appear (snapshot persistence path)
    const hasSnapshotUpsert = allowedWrites.some(
      (v) => v.model === 'employeePerformanceSnapshot' && v.method === 'upsert',
    )
    expect(hasSnapshotUpsert).toBe(true)
  })
})
