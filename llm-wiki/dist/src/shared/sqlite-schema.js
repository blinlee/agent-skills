export function ensureSqliteTableColumns(db, tableName, columns) {
    const existingColumns = new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
        .map((row) => row.name)
        .filter((name) => typeof name === 'string'));
    for (const column of columns) {
        if (existingColumns.has(column.name)) {
            continue;
        }
        db.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.definition}`).run();
    }
}
function quoteIdentifier(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
