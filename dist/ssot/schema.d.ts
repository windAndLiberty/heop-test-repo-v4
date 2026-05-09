import DatabaseConstructor = require('better-sqlite3');
type DB = DatabaseConstructor.Database;
/**
 * Schema Manager: handles SQLite database creation and schema initialization
 * Uses JSON1 extension for flexible metadata storage
 */
export declare class SchemaManager {
    private ssotDir;
    constructor(ssotDir: string);
    getDbPath(projectId: string): string;
    initializeProject(projectId: string, projectName: string, goal?: string): DB;
    private createTables;
    getConnection(projectId: string): DB;
    listProjects(): string[];
}
export {};
//# sourceMappingURL=schema.d.ts.map