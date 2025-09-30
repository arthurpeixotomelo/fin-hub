import { z } from "zod";
import { Hono } from "hono";
import ExcelJS from "exceljs";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { resolveDbPath } from "../utils/file";
import { withDuckDB } from "../db";
import { CREATE_PREVIEW_TABLE } from "../db/schema";
import type { DuckDBConnection } from "@duckdb/node-api";
import { REQUIRED_SHEETS, SEGMENTOS } from "../../utils/types";

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
  { progress: number; status: string; error?: string }
>();

function updateProgress(
  jobId: string,
  progress: number,
  status: string,
  error?: string,
) {
  progressStore.set(jobId, { progress, status, error });
}

upload.get("/progress/:jobId", (ctx) => {
  const jobId = ctx.req.param("jobId");
  const { progress = 0, status = "processing", error = undefined } =
    progressStore.get(jobId) ?? {};
  return ctx.json({ progress, status, error });
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
    return ctx.json({ error: (err as Error).message }, 500);
  }
});

upload.post("/finalize", async (ctx) => {
  const { fileName, teamName } = await ctx.req.json<{
    fileName: string;
    teamName: string;
  }>();

  if (!fileName || !teamName) {
    return ctx.json({ error: "Missing fileName or teamName" }, 400);
  }

  try {
    await withDuckDB(async (conn) => {
      // Check if preview table exists
      const tableExistsResult = await conn.run(`
        SELECT COUNT(*) as table_count 
        FROM information_schema.tables 
        WHERE table_name = 'preview'
      `);

      const tableExistsRows = await tableExistsResult.getRows();
      const tableExists = tableExistsRows[0]?.table_count > 0;

      if (!tableExists) {
        await conn.run(CREATE_PREVIEW_TABLE);
      }

      // Get next version number
      const versionResult = await conn.run(
        `SELECT COALESCE(MAX(version), 0) + 1 as next_version 
         FROM preview 
         WHERE team_name = ?`,
        [teamName],
      );

      const versionRows = await versionResult.getRows();
      const nextVersion = versionRows[0]?.next_version || 1;

      const tempFilePath = resolveDbPath(fileName);
      const schemaResult = await conn.run(`
        DESCRIBE SELECT * FROM read_parquet('${tempFilePath}')
      `);

      const schemaRows = await schemaResult.getRowObjectsJS();
      const columns = schemaRows.map(
        (r: { column_name: string }) => r.column_name,
      );
      const dateColumns = columns.filter((col) => MONTH_HEADER_RE.test(col));

      // Validate we have date columns
      if (dateColumns.length === 0) {
        throw new Error("No date columns found in the data");
      }

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
        params.push(teamName, nextVersion);
      }

      await conn.run(finalQuery, params);

      const teamParquetFileName = `team_${teamName}.parquet`;
      const teamParquetPath = resolveDbPath(teamParquetFileName);

      await conn.run(
        `
        COPY (
          SELECT * FROM preview 
          WHERE team_name = ?
          ORDER BY cod, dat_ref, version DESC
        ) TO '${teamParquetPath}' (FORMAT 'parquet')
      `,
        [teamName],
      );

      // Clean up temporary file
      // try {
      //   const fs = await import('node:fs/promises')
      //   await fs.unlink(tempFilePath)
      // } catch (cleanupErr) {
      //   console.warn(`Failed to clean up temporary file ${tempFilePath}:`, cleanupErr)
      // }
    });

    return ctx.json({
      success: true,
      message: "Data finalized successfully.",
      teamFile: `team_${teamName}.parquet`,
    });
  } catch (err) {
    return ctx.json({ error: (err as Error).message }, 500);
  }
});

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
        const errorMessage = `Validation error in sheet "${sheetName}" on row ${
          idx + 2
        }: ${
          err.issues
            .map((e) => `${e.path.join(".")} - ${e.message}`)
            .join(", ")
        }`;
        throw new Error(errorMessage);
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
        throw new Error(
          `Invalid non-numeric value found in sheet "${sheetName}", row ${
            idx + 2
          }, column "${header}". Found: "${val}".`,
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
        const sheetName = worksheet.name;
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
      throw new Error(`Missing required sheets: ${missingSheets.join(", ")}`);
    }
    updateProgress(jobId, 100, "done");
    return { fileName, validCount, invalidCount };
  } catch (err) {
    const errorMessage = (err as Error).message;

    throw new Error(errorMessage);
  }
}

export default upload;
