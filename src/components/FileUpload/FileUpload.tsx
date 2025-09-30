import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UploadProvider } from "./UploadState.tsx";
import UploadFlow from "./UploadFlow.tsx";
import Heading from "../Atoms/Heading.tsx";
import { TeamSelector } from "./UploadFlow";

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

    const [selectedTeam, setSelectedTeam] = useState("");

    return (
        <QueryClientProvider client={queryClient}>
            <UploadProvider>
                <Heading title="Upload" level={1}>
                    <TeamSelector
                        selectedTeam={selectedTeam}
                        onTeamSelect={setSelectedTeam}
                    />
                </Heading>
                <UploadFlow selectedTeam={selectedTeam} />
            </UploadProvider>
        </QueryClientProvider>
    );
}
