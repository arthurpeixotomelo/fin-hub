import { Hono } from 'hono';
import { DATABRICKS_CLUSTER_ID } from 'astro:env/server';
import { ensureClusterRunning, createContext, executeCommand, pollResult } from '../utils/databricks';

const dbQueryRoute = new Hono();

dbQueryRoute.post('/', async (ctx) => {
    const sql = 'select * from my_table';
    try {
        await ensureClusterRunning(DATABRICKS_CLUSTER_ID);
        const contextId = await createContext(DATABRICKS_CLUSTER_ID);
        const commandId = await executeCommand(contextId, sql, DATABRICKS_CLUSTER_ID);
        const result = await pollResult(contextId, commandId, DATABRICKS_CLUSTER_ID);
        return ctx.json({ data: result.result.data });
    } catch (err) {
        console.error('Error reading table: ', err);
        return ctx.text('Failed to read table', 500);
    }
});

export default dbQueryRoute;