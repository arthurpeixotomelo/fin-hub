import { z } from "zod";
import { Hono } from "hono";
import ExcelJS from "exceljs";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { resolveDbPath, withDuckDB } from "@db";
import { CREATE_PREVIEW_TABLE } from "@db/schema";
import type { DuckDBConnection } from "@duckdb/node-api";
import { REQUIRED_SHEETS, SEGMENTOS } from "../../utils/types";
import { CriticalError, WarningError } from "../../utils/errors";

const BRAZILIAN_TO_ENGLISH_MONTHS: Record<string, string> = {
  "Jan": "Jan",
  "Fev": "Feb",
  "Mar": "Mar",
  "Abr": "Apr",
  "Mai": "May",
  "Jun": "Jun",
  "Jul": "Jul",
  "Ago": "Aug",
  "Set": "Sep",
  "Out": "Oct",
  "Nov": "Nov",
  "Dez": "Dec",
};

const MONTH_HEADER_RE = /^\s*([A-Za-z]{3})\s*\/\s*(\d{2}|\d{4})\s*$/;
const TABLE_NAME = "preview_raw";

function convertBrazilianDateToEnglish(brazilianDate: string): string {
  const match = brazilianDate.match(MONTH_HEADER_RE);
  if (!match) return brazilianDate;
  const [, month, year] = match;
  const englishMonth = BRAZILIAN_TO_ENGLISH_MONTHS[month];
  if (!englishMonth) return brazilianDate;
  return `${englishMonth}/${year}`;
}

const financialRowSchema = z.object({
  Cod: z.number().int(),
  "Itens / Período": z.string(),
  Segmentos: z.enum(SEGMENTOS),
  File_Paths: z.string(),
  sheetName: z.enum(REQUIRED_SHEETS),
});

type FinancialRow = z.infer<typeof financialRowSchema> & {
  [key: string]: unknown;
};

const upload = new Hono();

const progressStore = new Map<
  string,
  { progress: number; status: string; error?: string; errorSeverity?: 'critical' | 'warning' }
>();

function updateProgress(
  jobId: string,
  progress: number,
  status: string,
  error?: string,
  errorSeverity?: 'critical' | 'warning',
) {
  progressStore.set(jobId, { progress, status, error, errorSeverity });
}

upload.get("/progress/:jobId", (ctx) => {
  const jobId = ctx.req.param("jobId");
  const { progress = 0, status = "processing", error = undefined, errorSeverity = undefined } =
    progressStore.get(jobId) ?? {};
  return ctx.json({ progress, status, error, errorSeverity });
});

upload.post("/process", async (ctx) => {
  const formData = await ctx.req.formData();
  const jobId = formData.get("jobId") as string;
  const file = formData.get("file") as File;
  if (!file || !file.name.endsWith(".xlsx")) {
    return ctx.json({ error: "Invalid file type" }, 400);
  }

  try {
    const result = await processFile(file, jobId);
    return ctx.json(result);
  } catch (err) {
    const errorSeverity = (err instanceof CriticalError || err instanceof WarningError) 
      ? err.severity 
      : 'critical';
    return ctx.json({ 
      error: (err as Error).message,
      errorSeverity 
    }, 500);
  }
});

upload.post("/finalize", async (ctx) => {
  const body = await ctx.req.json<{
    fileName?: string;
    teamId?: number;
    teamName?: string; // legacy
  }>();
  const { fileName, teamId, teamName: legacyTeamName } = body;

  if (!fileName) {
    return ctx.json({ error: "Missing fileName" }, 400);
  }

  // Resolve team name from id or fallback legacy or use default
  let resolvedTeamName = "default";
  
  if (teamId != null || legacyTeamName) {
    const teamResolution = await withDuckDB(async (conn) => {
      if (teamId != null) {
        const res = await conn.run(`SELECT name FROM teams WHERE id = ?`, [teamId]);
        const rowObjs = await res.getRowObjectsJS();
        const first = rowObjs[0] as Record<string, unknown> | undefined;
        return first?.name as string | undefined;
      } else if (legacyTeamName) {
        return legacyTeamName;
      }
    });

    if (teamResolution) {
      resolvedTeamName = teamResolution;
    }
  }

  const tempFilePath = resolveDbPath(fileName);

  try {
    await withDuckDB(async (conn) => {
      // Check if preview table exists
      const tableExistsResult = await conn.run(`
        SELECT COUNT(*)::INT as table_count 
        FROM information_schema.tables 
        WHERE table_name = 'preview'
      `);
      const tableExistsObj = await tableExistsResult.getRowObjectsJS();
      const tableExists = Boolean((tableExistsObj[0] as any)?.table_count);

      if (!tableExists) {
        await conn.run(CREATE_PREVIEW_TABLE);
      }

      // Get next version number
      const versionResult = await conn.run(
        `SELECT (COALESCE(MAX(version), 0) + 1)::INT as next_version 
         FROM preview 
         WHERE team_name = ?`,
        [resolvedTeamName],
      );
      const versionObjs = await versionResult.getRowObjectsJS();
      const nextVersion = (versionObjs[0] as any)?.next_version ?? 1;

      const schemaResult = await conn.run(`
        DESCRIBE SELECT * FROM read_parquet('${tempFilePath}')
      `);

      const schemaRows = await schemaResult.getRowObjectsJS();
      const columns = (schemaRows as any[]).map((r) => r.column_name as string);
      const dateColumns = columns.filter((col) => MONTH_HEADER_RE.test(col));

      // Validate we have date columns
      if (dateColumns.length === 0) {
        throw new Error("No date columns found in the data");
      }

      // Validate balance: RESULTADO - (CONTABIL + FICTICIO) = 0
      await validateSheetBalance(conn, tempFilePath, dateColumns);

      const unionQueries = dateColumns.map((dateCol) => {
        const englishDate = convertBrazilianDateToEnglish(dateCol);
        return `
        SELECT
          "Cod" AS cod,
          "Itens / Período" AS itens_periodo,
          "Segmentos" AS segmentos,
          "File_Paths" AS file_paths,
          "sheetName" AS sheet_name,
          ? AS team_name,
          strptime('${englishDate}', '%b/%y')::DATE AS dat_ref,
          "${dateCol}" AS value,
          ? AS version
        FROM read_parquet('${tempFilePath}')
        WHERE "${dateCol}" IS NOT NULL AND "${dateCol}" != 0
      `;
      }).join(" UNION ALL ");

      const finalQuery = `
        INSERT INTO preview (cod, itens_periodo, segmentos, file_paths, sheet_name, team_name, dat_ref, value, version)
        ${unionQueries}
      `;

      const params: (string | number)[] = [];
      for (let i = 0; i < dateColumns.length; i++) {
        params.push(resolvedTeamName, nextVersion);
      }

      await conn.run(finalQuery, params);
    });

    // Clean up temporary file and table
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(tempFilePath);
      console.log(`Cleaned up temporary file: ${tempFilePath}`);
    } catch (cleanupErr) {
      console.warn(`Failed to clean up temporary file ${tempFilePath}:`, cleanupErr);
    }

    // Clean up temp table if it exists
    try {
      await withDuckDB(async (conn) => {
        await conn.run(`DROP TABLE IF EXISTS ${TABLE_NAME}`);
        console.log(`Cleaned up temporary table: ${TABLE_NAME}`);
      });
    } catch (cleanupErr) {
      console.warn(`Failed to clean up temporary table ${TABLE_NAME}:`, cleanupErr);
    }

    return ctx.json({
      success: true,
      message: "Data finalized successfully.",
      teamName: resolvedTeamName,
      version: await withDuckDB(async (conn) => {
        const versionResult = await conn.run(
          `SELECT MAX(version)::INT as version FROM preview WHERE team_name = ?`,
          [resolvedTeamName],
        );
        const versionObjs = await versionResult.getRowObjectsJS();
        return (versionObjs[0] as any)?.version ?? 1;
      }),
    });
  } catch (err) {
    // Attempt cleanup even on error
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(tempFilePath);
    } catch {
      // Ignore cleanup errors on error path
    }
    return ctx.json({ error: (err as Error).message }, 500);
  }
});

async function validateSheetBalance(
  conn: DuckDBConnection,
  tempFilePath: string,
  dateColumns: string[],
): Promise<void> {
  // Check that RESULTADO - (CONTABIL + FICTICIO) = 0 for each cod, segmentos, and date
  for (const dateCol of dateColumns) {
    const validationQuery = `
      WITH sheet_data AS (
        SELECT 
          "Cod" AS cod,
          "Segmentos" AS segmentos,
          "sheetName" AS sheet_name,
          COALESCE("${dateCol}", 0) AS value
        FROM read_parquet('${tempFilePath}')
      ),
      pivoted AS (
        SELECT 
          cod,
          segmentos,
          SUM(CASE WHEN sheet_name = 'RESULTADO' THEN value ELSE 0 END) AS resultado,
          SUM(CASE WHEN sheet_name = 'CONTABIL' THEN value ELSE 0 END) AS contabil,
          SUM(CASE WHEN sheet_name = 'FICTICIO' THEN value ELSE 0 END) AS ficticio
        FROM sheet_data
        WHERE sheet_name IN ('RESULTADO', 'CONTABIL', 'FICTICIO')
        GROUP BY cod, segmentos
      ),
      imbalanced AS (
        SELECT 
          cod,
          segmentos,
          resultado,
          contabil,
          ficticio,
          (resultado - (contabil + ficticio)) AS diff,
          ABS(resultado - (contabil + ficticio)) AS abs_diff
        FROM pivoted
        WHERE ABS(resultado - (contabil + ficticio)) > 0.01
          AND (ABS(resultado) > 0.01 OR ABS(contabil) > 0.01 OR ABS(ficticio) > 0.01)
      )
      SELECT 
        cod,
        segmentos,
        resultado,
        contabil,
        ficticio,
        diff
      FROM imbalanced
      ORDER BY abs_diff DESC
      LIMIT 10
    `;

    const result = await conn.run(validationQuery);
    const imbalances = await result.getRowObjectsJS();

    if (imbalances.length > 0) {
      const firstError = imbalances[0] as any;
      const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
      
      const errorDetails = imbalances.map((row: any) => 
        `  Cod: ${row.cod}, Segmentos: "${row.segmentos}"\n` +
        `    RESULTADO: ${formatCurrency(row.resultado)}\n` +
        `    CONTABIL: ${formatCurrency(row.contabil)}\n` +
        `    FICTICIO: ${formatCurrency(row.ficticio)}\n` +
        `    Difference: ${formatCurrency(row.diff)}`
      ).join('\n\n');

      const errorMessage = `Sum of values for (Cod: ${firstError.cod}, Segmentos: "${firstError.segmentos}", Date: "${dateCol}") in sheet "RESULTADO" should sum zero with sum of the same values in "CONTABIL" and "FICTICIO" (difference: ${formatCurrency(firstError.diff)}).`;

      throw new CriticalError(
        errorMessage,
        `RESULTADO must equal (CONTABIL + FICTICIO) for each Cod and Segmentos combination.\n\nFound ${imbalances.length} imbalance(s):\n\n${errorDetails}`,
        {
          dateColumn: dateCol,
          totalImbalances: imbalances.length,
          firstImbalance: {
            cod: firstError.cod,
            segmentos: firstError.segmentos,
            resultado: firstError.resultado,
            contabil: firstError.contabil,
            ficticio: firstError.ficticio,
            difference: firstError.diff
          },
          allImbalances: imbalances
        }
      );
    }
  }
}

function parseSheetRows(
  headers: string[],
  rowsBuffer: Array<unknown[]>,
  sheetName: string,
): FinancialRow[] {
  const dateColIndices: number[] = [];
  for (let idx = 0; idx < headers.length; idx++) {
    const h = headers[idx];
    if (typeof h === "string" && MONTH_HEADER_RE.test(h)) {
      dateColIndices.push(idx);
    }
  }
  const codIdx = headers.findIndex((h: string) => h === "Cod");
  const itemIdx = headers.findIndex((h: string) => h === "Itens / Período");
  const segIdx = headers.findIndex((h: string) => h === "Segmentos");
  const fileIdx = headers.findIndex((h: string) => h === "File_Paths");

  const parsedRows: FinancialRow[] = [];
  for (const [idx, values] of rowsBuffer.entries()) {
    if (!Array.isArray(values)) continue;
    const rawRow = {
      Cod: Number(values[codIdx]),
      "Itens / Período": values[itemIdx] != null ? String(values[itemIdx]) : "",
      Segmentos: values[segIdx] != null ? String(values[segIdx]) : "",
      File_Paths: values[fileIdx] != null ? String(values[fileIdx]) : "",
      sheetName: sheetName,
    };
    try {
      financialRowSchema.parse(rawRow);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issue = err.issues[0];
        const fieldName = issue.path.join(".");
        const actualValue = rawRow[fieldName as keyof typeof rawRow];
        
        let expectedValue = "";
        if (issue.code === "invalid_union" || (issue as any).options) {
          const options = (issue as any).options || (issue as any).unionErrors?.[0]?.issues?.[0]?.options || [];
          expectedValue = options.length > 0 ? `one of [${options.join(", ")}]` : issue.message;
        } else if (issue.code === "invalid_type") {
          expectedValue = `type of ${(issue as any).expected}`;
        } else {
          expectedValue = issue.message;
        }

        const errorMessage = `Validation error in sheet "${sheetName}" on row ${
          idx + 2
        }: the value "${actualValue}" in field "${fieldName}" => value should be ${expectedValue}.`;
        
        const allIssues = err.issues
          .map((e) => {
            const field = e.path.join(".");
            const value = rawRow[field as keyof typeof rawRow];
            let expected = "";
            if (e.code === "invalid_union" || (e as any).options) {
              const opts = (e as any).options || (e as any).unionErrors?.[0]?.issues?.[0]?.options || [];
              expected = opts.length > 0 ? `one of [${opts.join(", ")}]` : e.message;
            } else if (e.code === "invalid_type") {
              expected = `type of ${(e as any).expected}`;
            } else {
              expected = e.message;
            }
            return `Field "${field}" has value "${value}" => should be ${expected}`;
          })
          .join("; ");
        
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
        );
      }
    }

    const row: Record<string, unknown> = { ...rawRow };

    for (const idx of dateColIndices) {
      const header = headers[idx];
      const val = values[idx];
      if (val == null || val === "") {
        row[header] = 0;
        continue;
      }
      const numVal = Number(val);
      if (!Number.isFinite(numVal)) {
        const errorMessage = `In sheet "${sheetName}" on row ${idx + 2}: the value "${val}" in column "${header}" => value should be type of number (numeric/decimal value).`;
        throw new CriticalError(
          errorMessage,
          `Column "${header}" contains non-numeric value "${val}" at row ${idx + 2}. Expected a numeric value for date columns.`,
          { sheet: sheetName, row: idx + 2, column: header, actualValue: val, expectedType: 'number' }
        );
      }
      row[header] = numVal;
    }
    parsedRows.push(row as FinancialRow);
  }
  return parsedRows;
}

async function insertRowsToDb(
  conn: DuckDBConnection,
  rows: FinancialRow[],
  jobId: string,
  dateHeaders: string[],
): Promise<{ validCount: number; invalidCount: number }> {
  const appender = await conn.createAppender(TABLE_NAME);
  let validCount = 0;
  let invalidCount = 0;
  for (const row of rows) {
    try {
      appender.appendInteger(row["Cod"]);
      appender.appendVarchar(row["Itens / Período"]);
      appender.appendVarchar(row["Segmentos"]);
      appender.appendVarchar(row["File_Paths"]);
      appender.appendVarchar(row["sheetName"]);
      for (const dateCol of dateHeaders) {
        const val = row[dateCol];
        appender.appendDouble(typeof val === "number" ? val : 0);
      }
      appender.endRow();
      validCount++;
    } catch (_err) {
      invalidCount++;
    }

    if ((validCount + invalidCount) % 100 === 0) {
      updateProgress(
        jobId,
        20 + Math.round((validCount / rows.length) * 70),
        "processing",
      );
      await Promise.resolve(); // Yield to event loop
    }
  }

  appender.closeSync();
  return { validCount, invalidCount };
}

async function processFile(
  file: File,
  jobId: string,
): Promise<{ fileName: string; validCount: number; invalidCount: number }> {
  const ts = Date.now();
  const fileName = `temp_${jobId}_${ts}.parquet`;
  const foundSheets = new Set<string>();
  let validCount = 0;
  let invalidCount = 0;
  try {
    updateProgress(jobId, 10, "processing");
    await withDuckDB(async (conn) => {
      let dateHeaders: string[] = [];
      let tableCreated = false;
      const stream = Readable.from(Buffer.from(await file.arrayBuffer()));
      const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(
        stream,
        {},
      );
      for await (const worksheet of workbookReader) {
        const sheetName = (worksheet as any).name as string;
        if (!REQUIRED_SHEETS.includes(sheetName as any)) continue;
        foundSheets.add(sheetName);

        updateProgress(
          jobId,
          15 +
            Math.round(
              (REQUIRED_SHEETS.indexOf(sheetName as any) /
                REQUIRED_SHEETS.length) *
                5,
            ),
          "processing",
        );
        let headers: string[] = [];
        const rowsBuffer: Array<unknown[]> = [];
        for await (const row of worksheet) {
          const values: unknown[] = Array.isArray(row.values)
            ? (row.values as unknown[]).slice(1)
            : [];
          if (row.number === 1) {
            headers = values.map((v: unknown) =>
              v == null ? "" : String(v).trim()
            );
            continue;
          }
          rowsBuffer.push(values);
        }
        if (headers.length === 0 || rowsBuffer.length === 0) continue;
        dateHeaders = headers.filter(
          (h) => typeof h === "string" && MONTH_HEADER_RE.test(h),
        );
        if (!tableCreated) {
          const columns = [
            "Cod INT",
            '"Itens / Período" VARCHAR',
            "Segmentos VARCHAR",
            "File_Paths VARCHAR",
            "sheetName VARCHAR",
          ].concat(
            dateHeaders.map((col) => `"${col}" DOUBLE`),
          );
          await conn.run(
            `CREATE OR REPLACE TABLE ${TABLE_NAME} (${columns.join(", ")})`,
          );
          tableCreated = true;
        }
        const parsedRows = parseSheetRows(headers, rowsBuffer, sheetName);
        const result = await insertRowsToDb(
          conn,
          parsedRows,
          jobId,
          dateHeaders,
        );
        validCount += result.validCount;
        invalidCount += result.invalidCount;
      }
      await conn.run(
        `COPY ${TABLE_NAME} TO '${
          resolveDbPath(
            fileName,
          )
        }' (FORMAT 'parquet')`,
      );
      updateProgress(jobId, 90, "processing");
    });
    const missingSheets = REQUIRED_SHEETS.filter(
      (sheet) => !foundSheets.has(sheet),
    );
    if (missingSheets.length > 0) {
      throw new CriticalError(
        'Missing required sheets in Excel file',
        `The following sheets are required but were not found: ${missingSheets.join(", ")}`,
        { missingSheets, requiredSheets: REQUIRED_SHEETS, foundSheets: Array.from(foundSheets) }
      );
    }
    updateProgress(jobId, 100, "done");
    return { fileName, validCount, invalidCount };
  } catch (err) {
    const error = err as CriticalError | WarningError | Error;
    const errorMessage = error.message;
    const errorSeverity = (error instanceof CriticalError || error instanceof WarningError)
      ? error.severity
      : 'critical';
    updateProgress(jobId, 0, "error", errorMessage, errorSeverity);
    
    // Clean up on error
    try {
      const tempFilePath = resolveDbPath(`temp_${jobId}_${ts}.parquet`);
      const fs = await import('node:fs/promises');
      await fs.unlink(tempFilePath);
      console.log(`Cleaned up failed upload temp file: ${tempFilePath}`);
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(errorMessage);
  }
}

export default upload;
