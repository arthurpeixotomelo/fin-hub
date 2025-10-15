import type { Hono } from 'hono'
import { withDuckDB, resolveDbPath } from '@db'
import { CREATE_PREVIEW_TABLE } from '@db/schema'
import type { DuckDBConnection } from '@duckdb/node-api'
import { MONTH_HEADER_RE, convertBrazilianDateToEnglish } from './index'
import { stat } from 'node:fs/promises'

export function registerFinalizeRoute(upload: Hono) {
  upload.post('/finalize', async ctx => {
    let payload: { fileName?: string; teamId?: number }
    try {
      payload = await ctx.req.json()
    } catch {
      return ctx.json({ error: 'Invalid JSON body' }, 400)
    }
    const { fileName, teamId } = payload

    if (!fileName || typeof fileName !== 'string') {
      return ctx.json({ error: 'Missing or invalid fileName' }, 400)
    }
    if (typeof teamId !== 'number' || !Number.isInteger(teamId)) {
      return ctx.json({ error: 'Missing or invalid teamId' }, 400)
    }

    const tempFilePath = resolveDbPath(fileName)

    try {
      await stat(tempFilePath)
    } catch {
      return ctx.json({ error: 'Temporary file not found (maybe already finalized or cleaned)' }, 404)
    }

    try {
      const result = await withDuckDB(async (conn: DuckDBConnection) => {
        await conn.run(CREATE_PREVIEW_TABLE)

        const schemaRes = await conn.run(`DESCRIBE SELECT * FROM read_parquet('${tempFilePath}')`)
        const schemaRows = await schemaRes.getRowObjectsJS()
        const allCols = (schemaRows as any[]).map(r => r.column_name as string)

        const dateCols = allCols.filter(c => MONTH_HEADER_RE.test(c))
        if (dateCols.length === 0) {
          return ctx.json({ error: 'No date columns found in temporary parquet' }, 400)
        }

        // Compute next version
        const verRes = await conn.run(
          `SELECT (COALESCE(MAX(version), 0) + 1)::INT AS next_version
             FROM preview
            WHERE team_name = (SELECT name FROM teams WHERE id = ?)`,
          [teamId]
        )
        const verObj = await verRes.getRowObjectsJS()
        const version = (verObj[0] as any)?.next_version ?? 1

        const union = dateCols.map(dateCol => {
          const english = convertBrazilianDateToEnglish(dateCol)
          const yearPart = english.split('/')[1] || ''
          const fmt = yearPart.length === 4 ? '%b/%Y' : '%b/%y'
          return `
            SELECT
              "Cod" AS cod,
              "Itens / Período" AS itens_periodo,
              "Segmentos" AS segmentos,
              "File_Paths" AS file_paths,
              "sheetName" AS sheet_name,
              (SELECT name FROM teams WHERE id = ${teamId}) AS team_name,
              strptime('${english}','${fmt}')::DATE AS dat_ref,
              "${dateCol}" AS value,
              ${version} AS version
            FROM read_parquet('${tempFilePath}')
            WHERE "${dateCol}" IS NOT NULL AND "${dateCol}" != 0
          `
        }).join(' UNION ALL ')

        const insertSql = `
          INSERT INTO preview
            (cod, itens_periodo, segmentos, file_paths, sheet_name, team_name, dat_ref, value, version)
          ${union}
        `
        await conn.run(insertSql)

        const countSql = `
          SELECT SUM(row_count) AS inserted
          FROM (
            ${dateCols.map(dateCol => {
              const english = convertBrazilianDateToEnglish(dateCol)
              const yearPart = english.split('/')[1] || ''
              const fmt = yearPart.length === 4 ? '%b/%Y' : '%b/%y'
              return `
                SELECT COUNT(*)::INTEGER AS row_count
                FROM read_parquet('${tempFilePath}')
                WHERE "${dateCol}" IS NOT NULL AND "${dateCol}" != 0
                  AND strptime('${english}','${fmt}') IS NOT NULL
              `
            }).join(' UNION ALL ')}
          )
        `
        const countRes = await conn.run(countSql)
        const countRows = await countRes.getRowObjectsJS()
        const insertedRows = (countRows[0] as any)?.inserted ?? 0

        return { version, insertedRows }
      })

      if (!result) return

      await cleanupTempResources(tempFilePath)

      return ctx.json({
        success: true,
        fileName
      })
    } catch (e) {
      console.error('[finalize] Error:', e)
      await cleanupTempResources(tempFilePath)
      return ctx.json({ error: (e as Error).message }, 500)
    }
  })
}

async function cleanupTempResources(tempFilePath: string) {
  try {
    const fs = await import('node:fs/promises')
    await fs.unlink(tempFilePath)
  } catch {}
  try {
    await withDuckDB(async conn => {
      await conn.run('DROP TABLE IF EXISTS preview_raw')
    })
  } catch {}
}