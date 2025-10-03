/// <reference path='../.astro/types.d.ts' />
/// <reference types="vite/client" />

declare namespace App {
    interface Locals {
        user?: import("./server/db/schema").User;
        loginTime?: number;
    }
}

interface ImportMetaEnv {
    readonly JWT_SECRET?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
