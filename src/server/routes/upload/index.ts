import { z } from "zod"
import { Hono } from "hono"
import ExcelJS from "exceljs"
import { Buffer } from "node:buffer"
import { Readable } from "node:stream"
import { resolveDbPath, withDuckDB } from "@db"
import type { DuckDBConnection } from "@duckdb/node-api"
import { REQUIRED_SHEETS, SEGMENTOS } from "@utils/types"
import { CriticalError, WarningError } from "@utils/errors"

export const BRAZILIAN_TO_ENGLISH_MONTHS: Record<string, string> = {
  Jan: 'Jan',
  Fev: 'Feb',
  Mar: 'Mar',
  Abr: 'Apr',
  Mai: 'May',
  Jun: 'Jun',
  Jul: 'Jul',
  Ago: 'Aug',
  Set: 'Sep',
  Out: 'Oct',
  Nov: 'Nov',
  Dez: 'Dec'
}

// Fix regex: ensure full end anchor ($) and allow optional trailing spaces
export const MONTH_HEADER_RE = /^\s*([A-Za-z]{3})\s*\/\s*(\d{2}|\d{4})\s*$/

const TABLE_NAME = "preview_raw"

export function convertBrazilianDateToEnglish(brazilianDate: string): string {
  const match = brazilianDate.match(MONTH_HEADER_RE)
  if (!match) return brazilianDate
  const [, month, year] = match
  const englishMonth = BRAZILIAN_TO_ENGLISH_MONTHS[month]
  if (!englishMonth) return brazilianDate
  return `${englishMonth}/${year}`
}

const financialRowSchema = z.object({
  Cod: z.number().int(),
  "Itens / Período": z.string(),
  Segmentos: z.enum(SEGMENTOS),
  File_Paths: z.string(),
  sheetName: z.enum(REQUIRED_SHEETS),
})

type FinancialRow = z.infer<typeof financialRowSchema> & {
  [key: string]: unknown;
};

const upload = new Hono()

const progressStore = new Map<
  string,
  { progress: number; status: string; error?: string; errorSeverity?: 'critical' | 'warning' }
>()

function updateProgress(
  jobId: string,
  progress: number,
  status: string,
  error?: string,
  errorSeverity?: 'critical' | 'warning',
) {
  progressStore.set(jobId, { progress, status, error, errorSeverity })
}

upload.get("/progress/:jobId", (ctx) => {
  const jobId = ctx.req.param("jobId")
  const { progress = 0, status = "processing", error = undefined, errorSeverity = undefined } =
    progressStore.get(jobId) ?? {}
  return ctx.json({ progress, status, error, errorSeverity })
})

upload.post("/process", async (ctx) => {
  const formData = await ctx.req.formData()
  const jobId = formData.get("jobId") as string
  const file = formData.get("file") as File
  if (!file || !file.name.endsWith(".xlsx")) {
    return ctx.json({ error: "Invalid file type" }, 400)
  }

  try {
    const result = await processFile(file, jobId)
    return ctx.json(result)
  } catch (err) {
    const isDomainError = err instanceof CriticalError || err instanceof WarningError
    const errorSeverity = isDomainError ? err.severity : 'critical'
    const details = isDomainError && 'details' in err ? String(err.details) : undefined
    const message = details ? `${err.message}\n\n${details}` : err.message
    return ctx.json({ error: message, errorSeverity }, 500)
  }
})

export async function validateSheetBalance(
  conn: DuckDBConnection,
  tempFilePath: string,
  dateColumns: string[]
): Promise<void> {
  if (dateColumns.length === 0) return

  const quotedColumns = dateColumns
    .map(col => `"${col.replace(/"/g, '""')}"`)
    .join(', ')

  const validationQuery = `
    WITH melted AS (
      SELECT
        "Cod" AS cod,
        "Segmentos" AS segmentos,
        "sheetName" AS sheet_name,
        month,
        COALESCE(value, 0) AS value
      FROM read_parquet('${tempFilePath}')
      UNPIVOT (value FOR month IN (${quotedColumns}))
    ),
    filtered AS (
      SELECT *
      FROM melted
      WHERE sheet_name IN ('RESULTADO','CONTABIL','FICTICIO')
    ),
    pivoted AS (
      SELECT
        cod,
        segmentos,
        month,
        SUM(CASE WHEN sheet_name = 'RESULTADO' THEN value ELSE 0 END) AS resultado,
        SUM(CASE WHEN sheet_name = 'CONTABIL' THEN value ELSE 0 END) AS contabil,
        SUM(CASE WHEN sheet_name = 'FICTICIO' THEN value ELSE 0 END) AS ficticio
      FROM filtered
      GROUP BY cod, segmentos, month
    ),
    imbalanced AS (
      SELECT
        cod,
        segmentos,
        month,
        resultado,
        contabil,
        ficticio,
        resultado - (contabil + ficticio) AS diff,
        ABS(resultado - (contabil + ficticio)) AS abs_diff
      FROM pivoted
      WHERE ABS(resultado - (contabil + ficticio)) > 0.01
    )
    SELECT cod, segmentos, month, resultado, contabil, ficticio, diff
    FROM imbalanced
    ORDER BY abs_diff DESC
  `
  const result = await conn.run(validationQuery)
  const imbalances = await result.getRowObjectsJS()

  if (imbalances.length === 0) return

  const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })

  const imbalanceDetails = imbalances
    .map(row => [
      `Cod: ${row.cod}`,
      `Segmentos: ${row.segmentos}`,
      `Mês: ${row.month}`,
      `RESULTADO = ${currency.format(row.resultado as number)}`,
      `CONTABIL  = ${currency.format(row.contabil as number)}`,
      `FICTICIO  = ${currency.format(row.ficticio as number)}`,
      `Diferença = ${currency.format(row.diff as number)}`
    ].join('\n'))
    .join('\n\n')

  throw new CriticalError(
    'Balance validation failed: sheet "RESULTADO" must equal "CONTABIL" + "FICTICIO" for every Cod/Segmentos/mês.',
    `Found ${imbalances.length} imbalance(s):\n\n${imbalanceDetails}`,
    { imbalances }
  )
}

function parseSheetRows(
  headers: string[],
  rowsBuffer: Array<unknown[]>,
  sheetName: string,
): FinancialRow[] {
  const dateColIndices: number[] = []
  for (let idx = 0; idx < headers.length; idx++) {
    const h = headers[idx]
    if (typeof h === "string" && MONTH_HEADER_RE.test(h)) {
      dateColIndices.push(idx)
    }
  }
  const codIdx = headers.findIndex((h: string) => h === "Cod")
  const itemIdx = headers.findIndex((h: string) => h === "Itens / Período")
  const segIdx = headers.findIndex((h: string) => h === "Segmentos")
  const fileIdx = headers.findIndex((h: string) => h === "File_Paths")

  const parsedRows: FinancialRow[] = []
  for (const [idx, values] of rowsBuffer.entries()) {
    if (!Array.isArray(values)) continue
    const rawRow = {
      Cod: Number(values[codIdx]),
      "Itens / Período": values[itemIdx] != null ? String(values[itemIdx]) : "",
      Segmentos: values[segIdx] != null ? String(values[segIdx]) : "",
      File_Paths: values[fileIdx] != null ? String(values[fileIdx]) : "",
      sheetName: sheetName,
    }
    try {
      financialRowSchema.parse(rawRow)
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issue = err.issues[0]
        const fieldName = issue.path.join(".")
        const actualValue = rawRow[fieldName as keyof typeof rawRow]
        
        let expectedValue = ""
        if (issue.code === "invalid_union" || (issue as any).options) {
          const options = (issue as any).options || (issue as any).unionErrors?.[0]?.issues?.[0]?.options || []
          expectedValue = options.length > 0 ? `one of [${options.join(", ")}]` : issue.message
        } else if (issue.code === "invalid_type") {
          expectedValue = `type of ${(issue as any).expected}`
        } else {
          expectedValue = issue.message
        }

        const errorMessage = `Validation error in sheet "${sheetName}" on row ${
          idx + 2
        }: the value "${actualValue}" in field "${fieldName}" => value should be ${expectedValue}.`
        
        const allIssues = err.issues
          .map((e) => {
            const field = e.path.join(".")
            const value = rawRow[field as keyof typeof rawRow]
            let expected = ""
            if (e.code === "invalid_union" || (e as any).options) {
              const opts = (e as any).options || (e as any).unionErrors?.[0]?.issues?.[0]?.options || []
              expected = opts.length > 0 ? `one of [${opts.join(", ")}]` : e.message
            } else if (e.code === "invalid_type") {
              expected = `type of ${(e as any).expected}`
            } else {
              expected = e.message
            }
            return `Field "${field}" has value "${value}" => should be ${expected}`
          })
          .join("; ")
        
        throw new CriticalError(
          errorMessage,
          allIssues,
          { 
            sheet: sheetName, 
            row: idx + 2, 
            field: fieldName,
            actualValue,
            expectedValue,
            allIssues: err.issues 
          }
        )
      }
    }

    const row: Record<string, unknown> = { ...rawRow }

    for (const idx of dateColIndices) {
      const header = headers[idx]
      const val = values[idx]
      if (val == null || val === "") {
        row[header] = 0
        continue
      }
      const numVal = Number(val)
      if (!Number.isFinite(numVal)) {
        const errorMessage = `In sheet "${sheetName}" on row ${idx + 2}: the value "${val}" in column "${header}" => value should be type of number (numeric/decimal value).`
        throw new CriticalError(
          errorMessage,
          `Column "${header}" contains non-numeric value "${val}" at row ${idx + 2}. Expected a numeric value for date columns.`,
          { sheet: sheetName, row: idx + 2, column: header, actualValue: val, expectedType: 'number' }
        )
      }
      row[header] = numVal
    }
    parsedRows.push(row as FinancialRow)
  }
  return parsedRows
}

async function insertRowsToDb(
  conn: DuckDBConnection,
  rows: FinancialRow[],
  jobId: string,
  dateHeaders: string[],
): Promise<{ validCount: number; invalidCount: number }> {
  const appender = await conn.createAppender(TABLE_NAME)
  let validCount = 0
  let invalidCount = 0
  for (const row of rows) {
    try {
      appender.appendInteger(row["Cod"])
      appender.appendVarchar(row["Itens / Período"])
      appender.appendVarchar(row["Segmentos"])
      appender.appendVarchar(row["File_Paths"])
      appender.appendVarchar(row["sheetName"])
      for (const dateCol of dateHeaders) {
        const val = row[dateCol]
        appender.appendDouble(typeof val === "number" ? val : 0)
      }
      appender.endRow()
      validCount++
    } catch (_err) {
      invalidCount++
    }

    if ((validCount + invalidCount) % 100 === 0) {
      updateProgress(
        jobId,
        20 + Math.round((validCount / rows.length) * 70),
        "processing",
      )
      await Promise.resolve() // Yield to event loop
    }
  }

  appender.closeSync()
  return { validCount, invalidCount }
}

async function processFile(
  file: File,
  jobId: string,
): Promise<{ fileName: string; validCount: number; invalidCount: number }> {
  const ts = Date.now()
  const fileName = `temp_${jobId}_${ts}.parquet`
  const foundSheets = new Set<string>()
  const allDateHeaders = new Set<string>()
  let validCount = 0
  let invalidCount = 0
  try {
    updateProgress(jobId, 10, "processing")
    await withDuckDB(async (conn) => {
      let dateHeaders: string[] = []
      let tableCreated = false
      const stream = Readable.from(Buffer.from(await file.arrayBuffer()))
      const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {})
      for await (const worksheet of workbookReader) {
        const sheetName = (worksheet as any).name as string
        if (!REQUIRED_SHEETS.includes(sheetName as any)) continue
        foundSheets.add(sheetName)

        updateProgress(
          jobId,
          15 +
            Math.round(
              (REQUIRED_SHEETS.indexOf(sheetName as any) /
                REQUIRED_SHEETS.length) *
                5,
            ),
          "processing",
        )
        let headers: string[] = []
        const rowsBuffer: Array<unknown[]> = []
        for await (const row of worksheet) {
          const values: unknown[] = Array.isArray(row.values)
            ? (row.values as unknown[]).slice(1)
            : []
          if (row.number === 1) {
            headers = values.map((v: unknown) =>
              v == null ? "" : String(v).trim()
            )
            continue
          }
          rowsBuffer.push(values)
        }
        if (headers.length === 0 || rowsBuffer.length === 0) continue
        dateHeaders = headers.filter(
          (h) => typeof h === "string" && MONTH_HEADER_RE.test(h),
        )
        dateHeaders.forEach(col => allDateHeaders.add(col))
        if (!tableCreated) {
          const columns = [
            "Cod INT",
            '"Itens / Período" VARCHAR',
            "Segmentos VARCHAR",
            "File_Paths VARCHAR",
            "sheetName VARCHAR",
          ].concat(
            dateHeaders.map((col) => `"${col}" DOUBLE`),
          )
          await conn.run(
            `CREATE OR REPLACE TABLE ${TABLE_NAME} (${columns.join(", ")})`,
          )
          tableCreated = true
        }
        const parsedRows = parseSheetRows(headers, rowsBuffer, sheetName)
        const result = await insertRowsToDb(
          conn,
          parsedRows,
          jobId,
          dateHeaders,
        )
        validCount += result.validCount
        invalidCount += result.invalidCount
      }
      const tempFilePath = resolveDbPath(fileName)
      await conn.run(
        `COPY ${TABLE_NAME} TO '${tempFilePath}' (FORMAT 'parquet')`,
      )
      await validateSheetBalance(conn, tempFilePath, Array.from(allDateHeaders))
      updateProgress(jobId, 95, "processing")
    })
    const missingSheets = REQUIRED_SHEETS.filter(
      (sheet) => !foundSheets.has(sheet),
    )
    if (missingSheets.length > 0) {
      throw new CriticalError(
        'Missing required sheets in Excel file',
        `The following sheets are required but were not found: ${missingSheets.join(", ")}`,
        { missingSheets, requiredSheets: REQUIRED_SHEETS, foundSheets: Array.from(foundSheets) }
      )
    }
    updateProgress(jobId, 100, "done")
    return { fileName, validCount, invalidCount }
  } catch (err) {
    const error = err as CriticalError | WarningError | Error
    const isDomainError = error instanceof CriticalError || error instanceof WarningError
    const details = isDomainError && 'details' in error ? String(error.details) : undefined
    const message = details ? `${error.message}\n\n${details}` : error.message
    const errorSeverity = isDomainError ? error.severity : 'critical'
    updateProgress(jobId, 0, "error", message, errorSeverity)

    try {
      const tempFilePath = resolveDbPath(`temp_${jobId}_${ts}.parquet`)
      const fs = await import('node:fs/promises')
      await fs.unlink(tempFilePath)
      console.log(`Cleaned up failed upload temp file: ${tempFilePath}`)
    } catch {
      // Ignore cleanup errors
    }

    throw error
  }
}

import { registerFinalizeRoute } from './finalize.ts'
registerFinalizeRoute(upload)

export default upload
