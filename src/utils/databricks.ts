import { DATABRICKS_TOKEN, DATABRICKS_HOST } from 'astro:env/server';

type DatabricksRequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    apiPath: string;
    body?: Record<string, unknown>;
    queryParams?: Record<string, string>;
}

export async function databricksAPI({
    method = 'GET',
    apiPath,
    body,
    queryParams
}: DatabricksRequestOptions): Promise<Response> {
    const url = new URL(`${DATABRICKS_HOST}${apiPath}`);
    if (queryParams) {
        Object.entries(queryParams).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });
    }
    const response = await fetch(url.toString(), {
        method,
        headers: {
            'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
        throw new Error(`Databricks API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

export async function createContext(clusterId: string): Promise<string> {
    const data = await databricksAPI({
        method: 'POST',
        apiPath: '/api/1.2/contexts/create',
        body: {
            clusterId: clusterId,
            language: 'sql'
        }
    });
    return data.id;
}

export async function executeCommand(contextId: string, sql: string, clusterId: string): Promise<any> {
    const data = await databricksAPI({
        method: 'POST',
        apiPath: '/api/1.2/commands/execute',
        body: {
            clusterId: clusterId,
            contextId: contextId,
            language: 'sql',
            command: sql,
        }
    });
    return data.id;
}

export async function pollResult(contextId: string, commandId: string, clusterId: string, timeout: number = 2000): Promise<void> {
    while (true) {
        const data = await databricksAPI({
            method: 'GET',
            apiPath: '/api/1.2/commands/status',
            queryParams: {
                contextId: contextId,
                commandId: commandId,
                clusterId: clusterId
            }
        });
        if (data.status === 'Finished') return data;
        if (data.status === 'Error') throw new Error(data.result?.cause || 'Unknown error');
        await new Promise(resolve => setTimeout(resolve, timeout));
    }
}

export async function ensureClusterRunning(clusterId: string, timeout: number = 5000): Promise<void> {
    let status = await databricksAPI({
        method: 'GET',
        apiPath: '/api/2.1/clusters/get',
        queryParams: {
            cluster_id: clusterId
        }
    });
    if (status.state === 'TERMINATED' || status.state === 'TERMINATING') {
        await databricksAPI({
            method: 'POST',
            apiPath: '/api/2.1/clusters/start',
            body: {
                cluster_id: clusterId
            }
        });

        while (status.state !== 'RUNNING') {
            await new Promise(resolve => setTimeout(resolve, timeout));
            status = await databricksAPI({
                method: 'GET',
                apiPath: '/api/2.1/clusters/get',
                queryParams: {
                    cluster_id: clusterId
                }
            });
        }
    }
}