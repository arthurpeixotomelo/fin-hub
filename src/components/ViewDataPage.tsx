import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTeamStore } from "@stores/team.ts";
import styles from "@styles/ViewData.module.css";
import DataTable from "./DataTable.tsx";
import Heading from "./Atoms/Heading.tsx";

interface PreviewRow {
    cod: number;
    itens_periodo: string;
    segmentos: string;
    file_paths: string;
    sheet_name: string;
    team_name: string;
    dat_ref: string;
    value: number;
    version: number;
    updated_at?: string;
}

interface Version {
    version: number;
    last_updated: string;
}

export default function ViewDataPage(): ReactNode {
    const teams = useTeamStore((s) => s.teams);
    const currentTeamId = useTeamStore((s) => s.currentTeamId);
    const teamStatus = useTeamStore((s) => s.status);
    const fetchTeams = useTeamStore((s) => s.fetchTeams);
    const setTeam = useTeamStore((s) => s.setTeam);

    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [page, setPage] = useState(0);
    const pageSize = 100;

    const selectedTeam = teams.find((t) => t.id === currentTeamId);
    const selectedTeamName = selectedTeam?.name || "";

    // Fetch teams on mount
    useEffect(() => {
        if (teamStatus === "idle") {
            fetchTeams();
        }
    }, [teamStatus, fetchTeams]);

    // Auto-select first team
    useEffect(() => {
        if (teams.length > 0 && currentTeamId == null) {
            setTeam(teams[0].id);
        }
    }, [teams, currentTeamId, setTeam]);

    // Fetch versions for selected team
    const versionsQuery = useQuery<{ versions: Version[] }>({
        queryKey: ["team-versions", selectedTeamName],
        enabled: !!selectedTeamName,
        queryFn: async () => {
            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/data/teams/${encodeURIComponent(selectedTeamName)}/versions`
            );
            if (!res.ok) throw new Error("Failed to fetch versions");
            return await res.json();
        },
    });

    // Auto-select latest version when team changes
    useEffect(() => {
        if (versionsQuery.data?.versions && versionsQuery.data.versions.length > 0) {
            const latestVersion = versionsQuery.data.versions[0].version;
            setSelectedVersion(latestVersion);
            setPage(0);
        } else {
            setSelectedVersion(null);
        }
    }, [versionsQuery.data]);

    // Fetch preview data
    const previewQuery = useQuery<{ rows: PreviewRow[]; total: number }>({
        queryKey: ["preview-data", selectedTeamName, selectedVersion, page],
        enabled: !!selectedTeamName && selectedVersion != null,
        queryFn: async () => {
            const params = new URLSearchParams({
                teamName: selectedTeamName,
                version: String(selectedVersion),
                limit: String(pageSize),
                offset: String(page * pageSize),
            });
            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/data/preview?${params}`
            );
            if (!res.ok) throw new Error("Failed to fetch preview data");
            return await res.json();
        },
    });

    const totalPages = previewQuery.data?.total
        ? Math.ceil(previewQuery.data.total / pageSize)
        : 0;

    // Transform data for DataTable
    const tableData = previewQuery.data?.rows.map((row) => ({
        Código: row.cod,
        "Itens/Período": row.itens_periodo,
        Segmentos: row.segmentos,
        "Caminho Arquivo": row.file_paths,
        Planilha: row.sheet_name,
        "Data Ref": new Date(row.dat_ref).toLocaleDateString("pt-BR"),
        Valor: row.value.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }),
        Versão: row.version,
    })) || [];

    return (
        <div className={styles.container}>
            <Heading title="View Data" level={1}>
                <div className={styles.controls}>
                    <select
                        className={styles.select}
                        value={currentTeamId ?? ""}
                        onChange={(e) => {
                            const id = e.target.value ? Number(e.target.value) : null;
                            setTeam(id);
                            setPage(0);
                        }}
                        disabled={teams.length === 0}
                    >
                        <option value="">Select Team</option>
                        {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>

                    {versionsQuery.data?.versions && versionsQuery.data.versions.length > 0 && (
                        <select
                            className={styles.select}
                            value={selectedVersion ?? ""}
                            onChange={(e) => {
                                setSelectedVersion(e.target.value ? Number(e.target.value) : null);
                                setPage(0);
                            }}
                        >
                            {versionsQuery.data.versions.map((v) => (
                                <option key={v.version} value={v.version}>
                                    Version {v.version} - {new Date(v.last_updated).toLocaleString("pt-BR")}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            </Heading>

            <div className={styles.content}>
                {!selectedTeamName && (
                    <div className={styles.emptyState}>
                        <p>Select a team to view data</p>
                    </div>
                )}

                {selectedTeamName && versionsQuery.isLoading && (
                    <div className={styles.emptyState}>
                        <p>Loading versions...</p>
                    </div>
                )}

                {selectedTeamName &&
                    !versionsQuery.isLoading &&
                    (!versionsQuery.data?.versions || versionsQuery.data.versions.length === 0) && (
                        <div className={styles.emptyState}>
                            <p>No data available for {selectedTeamName}</p>
                            <p className={styles.hint}>Upload data to see it here</p>
                        </div>
                    )}

                {selectedTeamName && selectedVersion != null && (
                    <>
                        <div className={styles.stats}>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Total Records:</span>
                                <span className={styles.statValue}>
                                    {previewQuery.data?.total.toLocaleString() || 0}
                                </span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Team:</span>
                                <span className={styles.statValue}>{selectedTeamName}</span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Version:</span>
                                <span className={styles.statValue}>{selectedVersion}</span>
                            </div>
                        </div>

                        <DataTable
                            rows={tableData}
                            loading={previewQuery.isLoading}
                            error={previewQuery.error as Error | null}
                        />

                        {totalPages > 1 && (
                            <div className={styles.pagination}>
                                <button
                                    className={styles.paginationButton}
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0 || previewQuery.isLoading}
                                >
                                    Previous
                                </button>
                                <span className={styles.paginationInfo}>
                                    Page {page + 1} of {totalPages}
                                </span>
                                <button
                                    className={styles.paginationButton}
                                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1 || previewQuery.isLoading}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
