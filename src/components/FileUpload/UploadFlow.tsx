import DataTable from "../DataTable.tsx";
import { useQuery } from "@tanstack/react-query";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { useState, useEffect } from "react";
import { formatFileSize } from "../../utils/helper.ts";
import { Dialog, Progress } from "radix-ui";
import Button from "../Atoms/Button.tsx";
import styles from "@styles/UploadFlow.module.css";
import { useUploadStore } from "@stores/upload.ts";
import { useTeamStore } from "@stores/team.ts";
import type { ErrorSeverity } from "@utils/errors";

export default function UploadFlow(): ReactNode {
    const fileName = useUploadStore((s) => s.fileName);
    const status = useUploadStore((s) => s.status);
    const uploadError = useUploadStore((s) => s.error);
    const errorSeverity = useUploadStore((s) => s.errorSeverity);
    const setProgress = useUploadStore((s) => s.setProgress);
    const jobId = useUploadStore((s) => s.jobId);
    const teams = useTeamStore((s) => s.teams);
    const currentTeamId = useTeamStore((s) => s.currentTeamId);
    const setTeam = useTeamStore((s) => s.setTeam);
    const teamStatus = useTeamStore((s) => s.status);
    const fetchTeams = useTeamStore((s) => s.fetchTeams);
    const effectiveTeam = teams.find((t) => t.id === currentTeamId)?.name ?? "";

    console.log('[UploadFlow] RENDER - teamStatus:', teamStatus, 'teams:', teams.length, 'currentTeamId:', currentTeamId, 'uploadStatus:', status);

    // Fetch teams on mount if needed
    // useEffect(() => {
    //     console.log('[UploadFlow] Effect 1 - checking teamStatus:', teamStatus, 'teams.length:', teams.length);
    //     if (teamStatus === "idle" || (teams.length === 0 && teamStatus !== "loading")) {
    //         console.log('[UploadFlow] Triggering fetchTeams...');
    //         fetchTeams();
    //     }
    // }, [teamStatus, teams.length, fetchTeams]);

    // Ensure a team is selected once teams are available
    // useEffect(() => {
    //     console.log('[UploadFlow] Effect 2 - teams:', teams.length, 'currentTeamId:', currentTeamId);
    //     if (teams.length > 0 && currentTeamId == null) {
    //         console.log('[UploadFlow] Auto-selecting first team:', teams[0].id);
    //         setTeam(teams[0].id);
    //     }
    // }, [teams, currentTeamId, setTeam]);

    const parquetQuery = useQuery({
        queryKey: ["parquet-data", fileName],
        enabled: !!fileName,
        queryFn: async () => {
            if (!fileName) return [];
            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/data/temp/${
                    encodeURIComponent(fileName)
                }`,
            );
            if (!res.ok) throw new Error("Failed to fetch data");
            return await res.json() as Record<string, unknown>[];
        },
    });

    // Progress polling
    useQuery<
        {
            progress: number;
            status: "idle" | "processing" | "done" | "error";
            error?: string;
            errorSeverity?: ErrorSeverity;
        }
    >({
        queryKey: ["upload-progress", jobId],
        enabled: !!jobId,
        refetchInterval: (query) => {
            const val = query.state.data;
            return val?.status === "processing" ? 250 : false;
        },
        queryFn: async () => {
            if (!jobId) return { progress: 0, status: "idle" as const };
            const r = await fetch(`/api/upload/progress/${jobId}`);
            if (!r.ok) throw new Error("Failed to fetch progress");
            const data = await r.json() as {
                progress: number;
                status: "idle" | "processing" | "done" | "error";
                error?: string;
                errorSeverity?: ErrorSeverity;
            };
            setProgress(data);
            return data;
        },
    });

    return (
        <div className={styles.uploadFlowRoot}>
            <section className={styles.uploadSection}>
                <FileInput />
                <ProgressBar />
                {fileName && (
                    <DataTable
                        rows={parquetQuery.data || []}
                        loading={parquetQuery.isLoading}
                        error={parquetQuery.error}
                    />
                )}
                <Actions teamName={effectiveTeam} teamId={currentTeamId ?? null} />
                {status === "error" && uploadError && (
                    <ErrorModal errorMessage={uploadError} severity={errorSeverity ?? 'critical'} />
                )}
            </section>
        </div>
    );
}

export function FileInput(): ReactNode {
    const file = useUploadStore((s) => s.file);
    const start = useUploadStore((s) => s.start);
    const isUploading = useUploadStore((s) =>
        s.status === "processing" && s.progress < 100
    );
    const [isDragOver, setIsDragOver] = useState(false);

    const isValidXlsx = (f: File) => (
        f.name.endsWith(".xlsx") &&
        f.type ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (!selected) return;
        if (!isValidXlsx(selected)) {
            alert("Invalid file format. Please select an .xlsx file.");
            return;
        }
        start(selected);
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (isUploading || file) return;
        setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);
        if (isUploading || file) return;
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) {
            if (!isValidXlsx(dropped)) {
                alert("Invalid file format. Please select an .xlsx file.");
                return;
            }
            start(dropped);
        }
    };

    return (
        <div
            className={`${styles.uploadArea} ${
                file ? styles.uploadAreaCompact : ""
            } ${isDragOver ? styles.uploadAreaActive : ""}`}
            onClick={() => document.getElementById("fileInput")?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <input
                id="fileInput"
                className={styles.hiddenInput}
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                disabled={isUploading || !!file}
                required
            />
            <div className={styles.uploadContent}>
                {file
                    ? (
                        <div className={styles.selectedFileDisplay}>
                            <div className={styles.selectedFileInfo}>
                                <p className={styles.selectedFileName}>
                                    {file.name}
                                </p>
                                <p className={styles.selectedFileSize}>
                                    {formatFileSize(file.size)}
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.changeFileButton}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const input = document.getElementById(
                                        "fileInput",
                                    ) as HTMLInputElement | null;
                                    if (input) input.value = "";
                                }}
                            >
                                Change File
                            </button>
                        </div>
                    )
                    : (
                        <>
                            <h3 className={styles.uploadTitle}>
                                Upload your Excel file
                            </h3>
                            <p className={styles.uploadDescription}>
                                Drag & drop or click to browse
                            </p>
                            <p className={styles.uploadFormats}>
                                Supported format: .xlsx
                            </p>
                        </>
                    )}
            </div>
        </div>
    );
}

export function ProgressBar(): ReactNode {
    const progress = useUploadStore((s) => s.progress);
    const status = useUploadStore((s) => s.status);
    const isProcessing = status === "processing";

    return (
        <div className={styles.progressSection} aria-busy={isProcessing}>
            <div className={styles.progressBar}>
                <Progress.Root
                    className={styles.progressRoot}
                    value={progress}
                    max={100}
                >
                    <Progress.Indicator
                        className={styles.progressIndicator}
                        style={{ width: `${progress}%` }}
                    />
                </Progress.Root>
                <p className={styles.progressLabel}>
                    Stage: {status} • {progress}%
                </p>
            </div>
            <span className={styles.progressText}>{progress}%</span>
        </div>
    );
}

export function Actions({ teamName, teamId }: { teamName: string; teamId: number | null }): ReactNode {
    const file = useUploadStore((s) => s.file);
    const status = useUploadStore((s) => s.status);
    const reset = useUploadStore((s) => s.reset);
    const finalize = useUploadStore((s) => s.finalize);
    const isFinalizing = useUploadStore((s) => s.isFinalizing);
    // Removed team requirement for now - allow submit when processing is done
    const canSubmit = status === "done"; // && !!teamId;
    
    console.log('[Actions] RENDER - status:', status, 'teamId:', teamId, 'canSubmit:', canSubmit, 'file:', !!file);
    
    useEffect(() => {
        console.log('[Actions] Effect - status changed to:', status, 'teamId:', teamId);
    }, [status, teamId]);

    const handleFinalize = () => {
        if (canSubmit) finalize(teamId, teamName);
    };

    return (
        <div className={styles.actionButtons}>
            <Button
                type="button"
                variant="outline"
                disabled={!file}
                onClick={reset}
            >
                Cancel
            </Button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <Button
                    type="button"
                    variant="primary"
                    loading={isFinalizing}
                    disabled={!canSubmit || isFinalizing}
                    onClick={handleFinalize}
                    title={!teamId ? 'Select a team first' : undefined}
                >
                    {isFinalizing ? "Submitting..." : "Submit"}
                </Button>
                {/* Temporarily disabled team requirement message */}
                {/* {!teamId && status === 'done' && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted, #666)' }}>
                        Select a team to enable submit
                    </span>
                )} */}
            </div>
        </div>
    );
}

export function ErrorModal(
    { errorMessage, severity = 'critical' }: { errorMessage: string; severity?: ErrorSeverity },
): ReactNode {
    const reset = useUploadStore((s) => s.reset);

    const severityConfig = {
        critical: {
            title: 'Upload Failed',
            color: '#ef4444',
            icon: '🚨'
        },
        warning: {
            title: 'Upload Warning',
            color: '#f59e0b',
            icon: '⚠️'
        }
    };

    const config = severityConfig[severity];

    return (
        <Dialog.Root open>
            <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content className={styles.dialogContent}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>{config.icon}</span>
                        <Dialog.Title className={styles.dialogTitle} style={{ color: config.color, margin: 0 }}>
                            {config.title}
                        </Dialog.Title>
                    </div>
                    <Dialog.Description className={styles.dialogDescription}>
                        The file could not be processed due to the following
                        {severity === 'critical' ? ' error' : ' issue'}:
                    </Dialog.Description>
                    <div 
                        className={styles.dialogErrorText}
                        style={{ 
                            borderLeft: `4px solid ${config.color}`,
                            paddingLeft: '1rem',
                            marginTop: '1rem'
                        }}
                    >
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {errorMessage}
                        </pre>
                    </div>
                    <div className={styles.dialogActions}>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                onClick={reset}
                                className={styles.dialogButton}
                            >
                                Try Again
                            </button>
                        </Dialog.Close>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
