import type Database from 'better-sqlite3'

export type SqliteColumnDefinition = {
  name: string
  definition: string
}

export function ensureSqliteTableColumns(
  db: Database.Database,
  tableName: string,
  columns: SqliteColumnDefinition[],
): void {
  const existingColumns = new Set(
    db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
      .map((row) => (row as { name?: unknown }).name)
      .filter((name): name is string => typeof name === 'string'),
  )

  for (const column of columns) {
    if (existingColumns.has(column.name)) {
      continue
    }
    db.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.definition}`).run()
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
