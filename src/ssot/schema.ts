import DatabaseConstructor = require('better-sqlite3');
import * as fs from 'fs';
import * as path from 'path';

// Type alias for better-sqlite3 Database instance
type DB = DatabaseConstructor.Database;

/**
 * Schema Manager: handles SQLite database creation and schema initialization
 * Uses JSON1 extension for flexible metadata storage
 */
export class SchemaManager {
  private ssotDir: string;

  constructor(ssotDir: string) {
    this.ssotDir = ssotDir;
    // Expand tilde to home directory
    if (this.ssotDir.startsWith('~')) {
      this.ssotDir = path.join(process.env.HOME || process.env.USERPROFILE || '', this.ssotDir.slice(1));
    }
    
    if (!fs.existsSync(this.ssotDir)) {
      fs.mkdirSync(this.ssotDir, { recursive: true });
    }
  }

  getDbPath(projectId: string): string {
    return path.join(this.ssotDir, `${projectId}.db`);
  }

  initializeProject(projectId: string, projectName: string, goal?: string): DB {
    const dbPath = this.getDbPath(projectId);
    const db = new DatabaseConstructor(dbPath);
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create all tables
    this.createTables(db);
    
    // Insert initial project record
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, state, goal, created_at, updated_at)
      VALUES (?, ?, 'CREATED', ?, unixepoch(), unixepoch())
    `);
    stmt.run(projectId, projectName, goal || null);

    return db;
  }

  private createTables(db: DB): void {
    // Projects table
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT CHECK(state IN (
          'CREATED','PLANNED','BOOTSTRAPPED',
          'INCREMENTAL_DEV','TESTING','DELIVERED','ARCHIVED','ADOPTED'
        )),
        goal TEXT,
        tech_stack_json TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);

    // Requirements table (immutable append)
    db.exec(`
      CREATE TABLE IF NOT EXISTS requirements (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        source_file TEXT,
        text TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        priority INTEGER DEFAULT 5,
        valid_from INTEGER DEFAULT (unixepoch()),
        valid_until INTEGER DEFAULT 9999999999
      )
    `);

    // Decisions table (XAI core)
    db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        context TEXT NOT NULL,
        choice TEXT NOT NULL,
        rationale TEXT NOT NULL,
        confidence REAL CHECK(confidence BETWEEN 0 AND 1),
        source_agent TEXT,
        parent_decision_id TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    // Facts table (Entity-Attribute-Value with time windows)
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        entity TEXT NOT NULL,
        attribute TEXT NOT NULL,
        value TEXT,
        value_type TEXT DEFAULT 'string',
        confidence REAL DEFAULT 1.0,
        source TEXT,
        valid_from INTEGER DEFAULT (unixepoch()),
        valid_until INTEGER DEFAULT 9999999999
      )
    `);

    // Tasks table (execution log)
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        requirement_id TEXT,
        agent_type TEXT NOT NULL CHECK(agent_type IN ('deepcode','claude','hermes','kimi')),
        status TEXT DEFAULT 'QUEUED',
        input_json TEXT,
        output_json TEXT,
        error_log TEXT,
        git_commit_hash TEXT,
        created_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER
      )
    `);

    // Milestones table
    db.exec(`
      CREATE TABLE IF NOT EXISTS milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        criteria_json TEXT NOT NULL,
        achieved_at INTEGER,
        git_tag TEXT,
        evidence_json TEXT
      )
    `);

    // Provenance log table
    db.exec(`
      CREATE TABLE IF NOT EXISTS provenance (
        id TEXT PRIMARY KEY,
        fact_id TEXT,
        operation TEXT CHECK(operation IN ('CREATE','INVALIDATE','UPDATE')),
        actor TEXT,
        input_context TEXT,
        reasoning_chain TEXT,
        timestamp INTEGER DEFAULT (unixepoch())
      )
    `);

    // Create indexes for common queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_requirements_valid ON requirements(valid_from, valid_until)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity, attribute)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(valid_from, valid_until)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_provenance_fact ON provenance(fact_id)`);
  }

  getConnection(projectId: string): DB {
    const dbPath = this.getDbPath(projectId);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Project database not found: ${dbPath}. Initialize project first.`);
    }
    const db = new DatabaseConstructor(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  }

  listProjects(): string[] {
    const files = fs.readdirSync(this.ssotDir);
    return files
      .filter(f => f.endsWith('.db'))
      .map(f => f.replace('.db', ''));
  }
}
