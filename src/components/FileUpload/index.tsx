import { useState } from "react";
import type { ReactNode } from "react";
import UploadFlow from "./UploadFlow.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function FileUpload(): ReactNode {
    const [queryClient] = useState(() =>
        new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: 1000 * 60 * 60,
                    retry: 1,
                    refetchOnWindowFocus: false,
                },
            },
        })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <UploadFlow />
        </QueryClientProvider>
    );
}
