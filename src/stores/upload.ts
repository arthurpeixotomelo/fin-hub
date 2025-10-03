import { create } from "zustand";
import type { ErrorSeverity } from "@utils/errors";

type Status = "idle" | "processing" | "done" | "error";

interface UploadState {
    file: File | null;
    jobId: string | null;
    fileName: string | null;
    status: Status;
    progress: number;
    error: string | null;
    errorSeverity: ErrorSeverity | null;
    isFinalizing: boolean;
    start: (file: File) => void;
    setProgress: (
        p: { progress: number; status: Status; error?: string; errorSeverity?: ErrorSeverity },
    ) => void;
    finalize: (teamId: number | null, teamNameLegacy?: string) => Promise<void>;
    reset: () => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
    file: null,
    jobId: null,
    fileName: null,
    status: "idle",
    progress: 0,
    error: null,
    errorSeverity: null,
    isFinalizing: false,
    start: (file) => {
        const jobId = crypto.randomUUID();
        set({ file, jobId, status: "processing", progress: 0, error: null, errorSeverity: null });
        const form = new FormData();
        form.append("file", file);
        form.append("jobId", jobId);
        fetch(`${import.meta.env.BASE_URL}/api/upload/process`, {
            method: "POST",
            body: form,
        })
            .then(async (r) => {
                if (!r.ok) {
                    const errorData = await r.json();
                    throw new Error(errorData.error || await r.text());
                }
                const data = await r.json();
                set({ fileName: data.fileName });
            })
            .catch((e) =>
                set({ status: "error", error: (e as Error).message, errorSeverity: 'critical' })
            );
    },
    setProgress: ({ progress, status, error, errorSeverity }) =>
        set({ progress, status, error: error ?? null, errorSeverity: errorSeverity ?? null }),
    finalize: async (teamId, teamNameLegacy) => {
        const { fileName } = get();
        if (!fileName || (teamId == null && !teamNameLegacy)) return;
        set({ isFinalizing: true });
        try {
            const r = await fetch(
                `${import.meta.env.BASE_URL}/api/upload/finalize`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fileName, teamId, teamName: teamNameLegacy }),
                },
            );
            if (!r.ok) {
                const errorData = await r.json();
                throw new Error(errorData.error || "Failed to finalize");
            }
            get().reset();
        } catch (e) {
            set({ status: "error", error: (e as Error).message, errorSeverity: 'critical' });
        } finally {
            set({ isFinalizing: false });
        }
    },
    reset: () =>
        set({
            file: null,
            jobId: null,
            fileName: null,
            status: "idle",
            progress: 0,
            error: null,
            errorSeverity: null,
            isFinalizing: false,
        }),
}));
