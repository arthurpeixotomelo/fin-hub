import type { ReactNode } from "react";
import { createContext, useContext, useReducer } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface RowObject {
    [key: string]: unknown;
}

interface UploadState {
    file: File | null;
    fileName: string | null;
    jobId: string | null;
}

type UploadAction =
    | { type: "START"; payload: { file: File; jobId: string } }
    | { type: "SET_FILE_NAME"; payload: string }
    | { type: "RESET" };

const initialState: UploadState = {
    file: null,
    fileName: null,
    jobId: null,
};

function uploadReducer(state: UploadState, action: UploadAction): UploadState {
    switch (action.type) {
        case "START":
            return {
                ...state,
                file: action.payload.file,
                jobId: action.payload.jobId,
            };
        case "SET_FILE_NAME":
            return { ...state, fileName: action.payload };
        case "RESET":
            return initialState;
        default:
            return state;
    }
}

interface UploadContextValue {
    // State
    file: File | null;
    fileName: string | null;
    jobId: string | null;

    // Progress (from React Query)
    progress: number;
    status: "idle" | "processing" | "done" | "error";
    isProcessing: boolean;
    error: string | null;

    // File data
    parquetData: RowObject[];
    isLoadingData: boolean;
    dataError: unknown;

    // Actions
    uploadFile: (file: File) => void;
    resetUpload: () => void;
    finalizeUpload: (teamName: string) => void;

    // Upload state
    isUploading: boolean;
    isFinalizing: boolean;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload(): UploadContextValue {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error("useUpload must be used inside UploadProvider");
    }
    return context;
}

export function UploadProvider(
    { children }: { children: ReactNode },
): ReactNode {
    const [state, dispatch] = useReducer(uploadReducer, initialState);
    const queryClient = useQueryClient();

    // Upload mutation
    const uploadMutation = useMutation({
        mutationFn: async ({ file, jobId }: { file: File; jobId: string }) => {
            const form = new FormData();
            form.append("file", file);
            form.append("jobId", jobId);

            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/upload/process`,
                {
                    method: "POST",
                    body: form,
                },
            );

            if (!res.ok) {
                console.error("Upload failed:", await res.text());
                throw new Error("Upload failed");
            }

            const data = await res.json();
            return data as { fileName: string };
        },
        onSuccess: (data) => {
            if (data?.fileName) {
                dispatch({ type: "SET_FILE_NAME", payload: data.fileName });
            }
        },
        onError: (error) => {
            console.error("Upload error:", error);
        },
    });

    // Finalize mutation
    const finalizeMutation = useMutation({
        mutationFn: async ({
            fileName,
            teamName,
        }: {
            fileName: string;
            teamName: string;
        }) => {
            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/upload/finalize`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fileName, teamName }),
                },
            );
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to finalize data.");
            }
            return res.json();
        },
        onSuccess: () => {
            // Optionally reset or show a success message
            alert("Data finalized successfully!");
            resetUpload();
        },
        onError: (error) => {
            alert(`Finalization failed: ${(error as Error).message}`);
        },
    });

    // Progress query
    const progressQuery = useQuery({
        queryKey: ["upload-progress", state.jobId],
        queryFn: async () => {
            if (!state.jobId) {
                return { progress: 0, status: "idle" as const, error: null };
            }

            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/upload/progress/${state.jobId}`,
            );

            if (!res.ok) {
                console.error("Progress fetch failed:", await res.text());
                throw new Error("Failed to fetch progress");
            }

            const data = await res.json();
            return data as {
                progress: number;
                status: "idle" | "processing" | "done" | "error";
                error?: string;
            };
        },
        enabled: !!state.jobId,
        refetchInterval: (query) => {
            const lastData = query.state.data;
            const interval = lastData?.status === "processing" ? 250 : false;
            return interval;
        },
    });

    const parquetDataQuery = useQuery<RowObject[]>({
        queryKey: ["parquet-data", state.fileName],
        queryFn: async () => {
            if (!state.fileName) return [];

            const res = await fetch(
                `${import.meta.env.BASE_URL}/api/data/temp/${
                    encodeURIComponent(state.fileName)
                }`,
            );

            if (!res.ok) {
                console.error("Data fetch failed:", await res.text());
                throw new Error("Failed to fetch data");
            }

            const data = await res.json();
            return data as RowObject[];
        },
        enabled: !!state.fileName,
    });

    const uploadFile = (file: File) => {
        const jobId = crypto.randomUUID();
        dispatch({ type: "START", payload: { file, jobId } });
        uploadMutation.mutate({ file, jobId });
    };

    const resetUpload = () => {
        dispatch({ type: "RESET" });
        queryClient.removeQueries({ queryKey: ["upload-progress"] });
        queryClient.removeQueries({ queryKey: ["parquet-data"] });
    };

    const finalizeUpload = (teamName: string) => {
        if (state.fileName) {
            finalizeMutation.mutate({ fileName: state.fileName, teamName });
        }
    };

    const progress = progressQuery.data?.progress ?? 0;
    const status = progressQuery.data?.status ?? "idle";
    const error = progressQuery.data?.error ?? null;
    const isProcessing = status === "processing";

    const contextValue = {
        // State
        file: state.file,
        fileName: state.fileName,
        jobId: state.jobId,

        // Progress
        progress,
        status,
        isProcessing,
        error,

        // Parquet data
        parquetData: parquetDataQuery.data || [],
        isLoadingData: parquetDataQuery.isLoading,
        dataError: parquetDataQuery.error,

        // Actions
        uploadFile,
        resetUpload,
        finalizeUpload,

        // Upload state
        isUploading: uploadMutation.isPending,
        isFinalizing: finalizeMutation.isPending,
    };

    return (
        <UploadContext value={contextValue}>
            {children}
        </UploadContext>
    );
}
