import { useState } from "react";
import type { ReactNode } from "react";
import ViewDataPage from "../ViewDataPage.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function ViewDataWrapper(): ReactNode {
    const [queryClient] = useState(() =>
        new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: 1000 * 60 * 5, // 5 minutes
                    retry: 1,
                    refetchOnWindowFocus: false,
                },
            },
        })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <ViewDataPage />
        </QueryClientProvider>
    );
}
