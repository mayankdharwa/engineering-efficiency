import { useTable, type ColumnDef, type Header, type RowData } from '@tanstack/react-table'
import { cn } from 'cn'
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react'
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
  onRowClick?: (row: TData) => void
  isRowSelected?: (row: TData) => boolean
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
      centerExcept && !centered && !extra && 'w-[22%]',
      extra,
    ) || undefined
  )
}

function isCentered(columnId: string, centerExcept?: readonly string[]): boolean {
  return Boolean(centerExcept) && !centerExcept?.includes(columnId)
}

function SortHeader<TData extends RowData>({
  header,
  table,
  centered,
}: {
  header: Header<typeof appTableFeatures, TData>
  table: ReturnType<typeof useTable<typeof appTableFeatures, TData>>
  centered: boolean
}) {
  const label = header.isPlaceholder ? null : <table.FlexRender header={header} />
  const column = header.column
  if (!column.getCanSort()) return label

  const sorted = column.getIsSorted()
  const Icon =
    sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ChevronsUpDownIcon
  return (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 rounded-sm select-none hover:text-foreground',
        centered && 'justify-center',
      )}
      onClick={column.getToggleSortingHandler()}
    >
      {label}
      <Icon
        className={cn('size-3.5 shrink-0', sorted ? 'text-foreground' : 'text-muted-foreground/70')}
        aria-hidden
      />
    </button>
  )
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = 'No rows to show.',
  centerExcept,
  onRowClick,
  isRowSelected,
}: DataTableProps<TData>) {
  const table = useTable({ features: appTableFeatures, columns, data })
  const rows = table.getRowModel().rows

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={centerExcept ? 'table-fixed' : undefined}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getCanSort() ? header.column.getIsSorted() : undefined
                return (
                  <TableHead
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : sorted === false
                            ? 'none'
                            : undefined
                    }
                    className={columnClassName(
                      header.column.id,
                      header.column.columnDef.meta,
                      centerExcept,
                    )}
                  >
                    <SortHeader
                      header={header}
                      table={table}
                      centered={isCentered(header.column.id, centerExcept)}
                    />
                  </TableHead>
                )
              })}
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
              <TableRow
                key={row.id}
                data-selected={isRowSelected?.(row.original) || undefined}
                className={
                  onRowClick
                    ? 'cursor-pointer data-[selected=true]:bg-muted'
                    : undefined
                }
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
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
