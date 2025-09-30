import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import styles from "../styles/DataTable.module.css";
import Button from "./Atoms/Button.tsx";
import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { REQUIRED_SHEETS } from "../utils/types.ts";

interface RowObject {
    [key: string]: unknown;
}

interface DataTableProps {
    rows: RowObject[];
    loading: boolean;
    error?: unknown;
    pageSize?: number;
    enableSheetFilter?: boolean;
}

function DataTable({
    rows,
    loading,
    error,
    pageSize = 50,
    enableSheetFilter = true,
}: DataTableProps): ReactNode {
    if (loading) return <div className={styles.state}>Loading data...</div>;
    if (error) {
        return (
            <div className={`${styles.state} ${styles.stateError}`}>
                Failed to load data
            </div>
        );
    }
    if (!rows || rows.length === 0) {
        return <div className={styles.state}>No data available</div>;
    }

    const sheetNames = enableSheetFilter ? REQUIRED_SHEETS : [];
    const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

    const filteredRows = useMemo(() => {
        if (!enableSheetFilter || !selectedSheet) return rows;
        return rows.filter((r) => r.sheetName === selectedSheet);
    }, [rows, selectedSheet, enableSheetFilter]);

    const columns = useMemo<ColumnDef<RowObject, unknown>[]>(() => {
        if (filteredRows.length === 0) return [];
        const keys = Array.from(
            filteredRows.reduce((acc, row) => {
                Object.keys(row).forEach((k) => acc.add(k));
                return acc;
            }, new Set<string>()),
        );
        return keys.map<ColumnDef<RowObject>>((key) => ({
            id: key,
            header: key,
            accessorFn: (row) => (row as Record<string, unknown>)[key],
            cell: (info) => {
                const v = info.getValue() as unknown;
                if (v === null || v === undefined) return "";
                if (typeof v === "number") return v.toLocaleString();
                return String(v);
            },
        }));
    }, [filteredRows]);

    const [pageIndex, setPageIndex] = useState(0);

    const table = useReactTable({
        data: filteredRows,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        state: { pagination: { pageIndex, pageSize } },
        pageCount: Math.ceil(filteredRows.length / pageSize),
        onPaginationChange: (updater) => {
            if (typeof updater === "function") {
                const next = updater({ pageIndex, pageSize });
                setPageIndex(next.pageIndex);
            } else {
                setPageIndex(updater.pageIndex);
            }
        },
    });

    const rowsToRender = table.getRowModel().rows;

    return (
        <div className={styles.root}>
            {enableSheetFilter && (
                <div className={styles.toolbar}>
                    <div className={styles.filterGroup}>
                        <label className={styles.filterLabel}>
                            Sheet:
                            <select
                                className={styles.select}
                                value={selectedSheet ?? ""}
                                onChange={(e) =>
                                    setSelectedSheet(e.target.value || null)}
                            >
                                <option value="">All</option>
                                {sheetNames.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>
            )}
            <div className={styles.wrapper}>
                <table className={styles.table}>
                    <thead className={styles.thead}>
                        {table.getHeaderGroups().map((hg) => (
                            <tr key={hg.id} className={styles.row}>
                                {hg.headers.map((h) => (
                                    <th key={h.id} className={styles.th}>
                                        {flexRender(
                                            h.column.columnDef.header,
                                            h.getContext(),
                                        )}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {rowsToRender.map((r) => (
                            <tr key={r.id} className={styles.row}>
                                {r.getVisibleCells().map((c) => (
                                    <td key={c.id} className={styles.td}>
                                        {flexRender(
                                            c.column.columnDef.cell,
                                            c.getContext(),
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className={styles.pagination}>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex((p) => Math.max(p - 1, 0))}
                >
                    Previous
                </Button>
                <span className={styles.pageInfo}>
                    Page {pageIndex + 1} of {table.getPageCount()}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pageIndex >= table.getPageCount() - 1}
                    onClick={() =>
                        setPageIndex((p) =>
                            Math.min(p + 1, table.getPageCount() - 1)
                        )}
                >
                    Next
                </Button>
            </div>
        </div>
    );
}

export default memo(DataTable);
