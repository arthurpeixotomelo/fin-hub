import DataTable from "../DataTable.tsx";
import { useUpload } from "./UploadState.tsx";
import { useQuery } from "@tanstack/react-query";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { formatFileSize } from "../../utils/helper.ts";
import type { Team } from "../../server/db/schema.ts";
import { Dialog, Progress, Select } from "radix-ui";
import Button from "../Atoms/Button.tsx";
import styles from "../../styles/UploadFlow.module.css";

export default function UploadFlow({ selectedTeam }: {
    selectedTeam: string;
}): ReactNode {
    const {
        fileName,
        parquetData,
        isLoadingData,
        dataError,
        status,
        error: uploadError,
    } = useUpload();

    return (
        <div className={styles.uploadFlowRoot}>
            <section className={styles.uploadSection}>
                <FileInput />
                <ProgressBar />
                {fileName && (
                    <DataTable
                        rows={parquetData}
                        loading={isLoadingData}
                        error={dataError}
                    />
                )}
                <Actions teamName={selectedTeam} />
                {status === "error" && uploadError && (
                    <ErrorModal errorMessage={uploadError} />
                )}
            </section>
        </div>
    );
}

export function FileInput(): ReactNode {
    const { file, isUploading, uploadFile } = useUpload();
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
        uploadFile(selected);
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
            uploadFile(dropped);
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

async function fetchTeams(): Promise<Team[]> {
    const res = await fetch(`${import.meta.env.BASE_URL}/api/data/teams`);
    if (!res.ok) {
        throw new Error("Failed to fetch teams");
    }
    return res.json();
}

export function TeamSelector(
    { selectedTeam, onTeamSelect }: {
        selectedTeam: string;
        onTeamSelect: (team: string) => void;
    },
): ReactNode {
    const { data: teams, isLoading, isError } = useQuery({
        queryKey: ["teams"],
        queryFn: fetchTeams,
    });

    useEffect(() => {
        if (teams && teams.length > 0 && !selectedTeam) {
            onTeamSelect(teams[0].name);
        }
    }, [teams, selectedTeam, onTeamSelect]);

    if (isLoading) {
        return <p>Loading teams...</p>;
    }

    if (isError) {
        return <p>Error loading teams.</p>;
    }

    return (
        <Select.Root
            value={selectedTeam}
            onValueChange={onTeamSelect}
            disabled={!teams || teams.length === 0}
        >
            <Select.Trigger
                className={styles.teamSelectTrigger}
                aria-label="Team"
            >
                <Select.Value />
            </Select.Trigger>
            <Select.Portal>
                <Select.Content
                    className={styles.teamSelectContent}
                    position="popper"
                >
                    <Select.Viewport
                        className={styles.teamSelectViewport}
                    >
                        {teams && teams.map((team) => (
                            <Select.Item
                                key={team.id}
                                value={team.name}
                                className={styles.teamSelectItem}
                            >
                                <Select.ItemText>
                                    {team.name}
                                </Select.ItemText>
                            </Select.Item>
                        ))}
                    </Select.Viewport>
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    );
}

export function ProgressBar(): ReactNode {
    const { progress, status } = useUpload();
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

export function Actions({ teamName }: { teamName: string }): ReactNode {
    const { file, status, resetUpload, finalizeUpload, isFinalizing } =
        useUpload();
    const canSubmit = status === "done";

    const handleFinalize = () => {
        if (canSubmit) {
            finalizeUpload(teamName);
        }
    };

    return (
        <div className={styles.actionButtons}>
            <Button
                type="button"
                variant="outline"
                disabled={!file}
                onClick={resetUpload}
            >
                Cancel
            </Button>
            <Button
                type="button"
                variant="primary"
                loading={isFinalizing}
                disabled={!canSubmit || isFinalizing}
                onClick={handleFinalize}
            >
                {isFinalizing ? "Submitting..." : "Submit"}
            </Button>
        </div>
    );
}

export function ErrorModal(
    { errorMessage }: { errorMessage: string },
): ReactNode {
    const { resetUpload } = useUpload();

    return (
        <Dialog.Root open>
            <Dialog.Portal>
                <Dialog.Overlay className={styles.dialogOverlay} />
                <Dialog.Content className={styles.dialogContent}>
                    <Dialog.Title className={styles.dialogTitle}>
                        Upload Failed
                    </Dialog.Title>
                    <Dialog.Description className={styles.dialogDescription}>
                        The file could not be processed due to the following
                        error:
                    </Dialog.Description>
                    <pre className={styles.dialogErrorText}>{errorMessage}</pre>
                    <div className={styles.dialogActions}>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                onClick={resetUpload}
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
