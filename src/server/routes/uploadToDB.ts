import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { getTeamParquetPath } from '../db/parquetManager';
import { Hono } from 'hono';
import { databricksAPI } from '../../utils/databricks';

const CHUNK_SIZE = 1024 * 1024;

const uploadToDB = new Hono();

uploadToDB.post('/', async (ctx) => {
  try {
    const { teamId } = await ctx.req.json();
    if (!teamId) return ctx.json({ error: 'Missing teamId' }, 400);
    const parquetPath = getTeamParquetPath(teamId);
    if (!parquetPath) return ctx.json({ error: 'Parquet not found for team' }, 404);
    const fileName = path.basename(parquetPath);
    const createRes = await databricksAPI({
      method: 'POST',
      apiPath: '/api/2.0/dbfs/create',
      body: { path: `/app/_previa/${teamId}/${fileName}`, overwrite: true },
    });
    const handle = createRes.handle;
    if (!handle) throw new Error('Failed to get DBFS handle');
    const fd = fs.openSync(parquetPath, 'r');
    try {
      const stat = fs.statSync(parquetPath);
      const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
      let offset = 0;

      while (offset < stat.size) {
        const toRead = Math.min(CHUNK_SIZE, stat.size - offset);
        const bytesRead = fs.readSync(fd, buffer, 0, toRead, offset);
        if (bytesRead <= 0) break;
        offset += bytesRead;

        const base64 = buffer.subarray(0, bytesRead).toString('base64');
        await databricksAPI({
          method: 'POST',
          apiPath: '/api/2.0/dbfs/add-block',
          body: { handle, data: base64 },
        });
      }

      await databricksAPI({
        method: 'POST',
        apiPath: '/api/2.0/dbfs/close',
        body: { handle },
      });

      return ctx.json({ ok: true, file: fileName, bytes: stat.size });
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    console.error(err);
    return ctx.json({ error: (err as Error).message }, 500);
  }
});

export default uploadToDB;
