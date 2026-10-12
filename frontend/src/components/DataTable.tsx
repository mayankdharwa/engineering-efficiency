import { useTable, type ColumnDef, type RowData } from '@tanstack/react-table'
import { cn } from 'cn'
import { appTableFeatures } from '../lib/table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type AppColumnMeta = {
  className?: string
}

export type AppColumnDef<TData extends RowData> = ColumnDef<
  typeof appTableFeatures,
  TData,
  any
>

interface DataTableProps<TData extends RowData> {
  columns: AppColumnDef<TData>[]
  data: TData[]
  emptyMessage?: string
  /** Column ids that stay left-aligned. Every other column is centered. */
  centerExcept?: readonly string[]
}

function columnClassName(
  columnId: string,
  meta: unknown,
  centerExcept?: readonly string[],
): string | undefined {
  const extra = (meta as AppColumnMeta | undefined)?.className
  const centered = Boolean(centerExcept) && !centerExcept?.includes(columnId)
  return (
    cn(
      centered && 'text-center whitespace-normal',
      centerExcept && !centered && 'w-[22%]',
      extra,
    ) || undefined
  )
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = 'No rows to show.',
  centerExcept,
}: DataTableProps<TData>) {
  const table = useTable({ features: appTableFeatures, columns, data })
  const rows = table.getRowModel().rows

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={centerExcept ? 'table-fixed' : undefined}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  scope="col"
                  className={columnClassName(
                    header.column.id,
                    header.column.columnDef.meta,
                    centerExcept,
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={columnClassName(
                      cell.column.id,
                      cell.column.columnDef.meta,
                      centerExcept,
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
