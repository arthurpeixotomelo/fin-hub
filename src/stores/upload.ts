import { create } from "zustand";
import type { ErrorSeverity } from "@utils/errors";

export type UploadStatus = "idle" | "processing" | "done" | "submitting" | "error";

interface UploadState {
    file: File | null;
    jobId: string | null;
    fileName: string | null;
    status: UploadStatus;
    progress: number;
    error: string | null;
    errorSeverity: ErrorSeverity | null;
    start: (file: File) => void;
    setProgress: (
        p: { progress: number; status: UploadStatus; error?: string; errorSeverity?: ErrorSeverity },
    ) => void;
    finalize: (teamId: number | null) => Promise<void>;
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

    start: async (file) => {
        const jobId = crypto.randomUUID();
        set({ file, jobId, status: "processing", progress: 0, error: null, errorSeverity: null });

        const form = new FormData();
        form.append("file", file);
        form.append("jobId", jobId);

        try {
            const res = await fetch(`${import.meta.env.BASE_URL}/api/upload/process`, {
                method: "POST",
                body: form,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || await res.text());
            }
            const data = await res.json();
            set({ fileName: data.fileName });
        } catch (e) {
            set({ status: "error", error: (e as Error).message, errorSeverity: 'critical' });
        }
    },

    setProgress: ({ progress, status, error, errorSeverity }) => {
        set({ progress, status, error: error ?? null, errorSeverity: errorSeverity ?? null });
    },

    finalize: async (teamId) => {
        const { fileName, status } = get();
        if (!fileName || teamId == null || status !== 'done') return;
        set({ status: 'submitting', error: null, errorSeverity: null });
        try {
            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/upload/finalize`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fileName, teamId }),
                },
            );
            const raw = await res.text();
            let parsed: any = null;
            try { parsed = JSON.parse(raw) } catch { /* raw may be plain text */ }
            if (!res.ok) {
                const msg = parsed?.error || raw || 'Failed to finalize'
                throw new Error(msg)
            }
            // On success just reset
            get().reset();
        } catch (e) {
            set({
                status: 'error',
                error: (e as Error).message,
                errorSeverity: 'critical'
            });
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
        }),
}));
