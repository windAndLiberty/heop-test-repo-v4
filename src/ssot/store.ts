import DatabaseConstructor = require('better-sqlite3');
import { SchemaManager } from './schema.js';

/**
 * SSOT Store: Single Source of Truth data access layer
 * Enforces immutable append-only updates and event sourcing discipline
 */
export interface FactRecord {
  id: string;
  project_id: string;
  entity: string;
  attribute: string;
  value: string;
  value_type?: string;
  confidence?: number;
  source?: string;
  valid_from?: number;
  valid_until?: number;
}

export interface DecisionRecord {
  id: string;
  project_id: string;
  context: string;
  choice: string;
  rationale: string;
  confidence: number;
  source_agent: string;
  parent_decision_id?: string;
  created_at?: number;
}

export interface TaskRecord {
  id: string;
  project_id: string;
  requirement_id?: string;
  agent_type: 'deepcode' | 'claude' | 'hermes';
  status: string;
  input_json?: string;
  output_json?: string;
  error_log?: string;
  git_commit_hash?: string;
  created_at?: number;
  started_at?: number;
  completed_at?: number;
}

export interface MilestoneRecord {
  id: string;
  project_id: string;
  name: string;
  criteria_json: string;
  achieved_at?: number;
  git_tag?: string;
  evidence_json?: string;
}

export class SSOTStore {
  private schema: SchemaManager;

  constructor(schemaOrDir: SchemaManager | string) {
    if (typeof schemaOrDir === 'string') {
      this.schema = new SchemaManager(schemaOrDir);
    } else {
      this.schema = schemaOrDir;
    }
  }

  // === Project Operations ===

  createProject(projectId: string, name: string, goal?: string): void {
    this.schema.initializeProject(projectId, name, goal);
  }

  getProject(projectId: string): any {
    const db = this.schema.getConnection(projectId);
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    return stmt.get(projectId);
  }

  updateProjectState(projectId: string, newState: string): void {
    const db = this.schema.getConnection(projectId);
    const stmt = db.prepare(`
      UPDATE projects 
      SET state = ?, updated_at = unixepoch() 
      WHERE id = ?
    `);
    stmt.run(newState, projectId);
  }

  // === Immutable Fact Operations ===

  addFact(
    projectId: string,
    entity: string,
    attribute: string,
    value: string,
    valueType?: string,
    confidence?: number,
    source?: string
  ): string {
    return this.insertFact(projectId, {
      entity,
      attribute,
      value,
      value_type: valueType || 'string',
      confidence: confidence || 1.0,
      source
    });
  }

  /**
   * Insert a new fact. If a fact with same entity+attribute exists,
   * invalidate the old one first (event sourcing discipline).
   */
  insertFact(projectId: string, fact: Omit<FactRecord, 'id' | 'project_id' | 'valid_from'>): string {
    const db = this.schema.getConnection(projectId);
    const id = `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    db.transaction(() => {
      // Invalidate existing fact for same entity+attribute
      const invalidateStmt = db.prepare(`
        UPDATE facts 
        SET valid_until = ? 
        WHERE project_id = ? AND entity = ? AND attribute = ? AND valid_until = 9999999999
      `);
      invalidateStmt.run(now, projectId, fact.entity, fact.attribute);

      // Insert new fact
      const insertStmt = db.prepare(`
        INSERT INTO facts (id, project_id, entity, attribute, value, value_type, confidence, source, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 9999999999)
      `);
      insertStmt.run(
        id, projectId, fact.entity, fact.attribute, fact.value,
        fact.value_type || 'string', fact.confidence ?? 1.0, fact.source || 'unknown', now
      );
    })();

    return id;
  }

  getCurrentFacts(projectId: string, entity?: string, attribute?: string): any[] {
    const db = this.schema.getConnection(projectId);
    const now = Math.floor(Date.now() / 1000);
    
    let sql = `
      SELECT * FROM facts 
      WHERE project_id = ? AND valid_from <= ? AND valid_until > ?
    `;
    const params: any[] = [projectId, now, now];

    if (entity) {
      sql += ' AND entity = ?';
      params.push(entity);
    }
    if (attribute) {
      sql += ' AND attribute = ?';
      params.push(attribute);
    }

    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  getFactHistory(projectId: string, entity: string, attribute: string): any[] {
    const db = this.schema.getConnection(projectId);
    const stmt = db.prepare(`
      SELECT * FROM facts 
      WHERE project_id = ? AND entity = ? AND attribute = ?
      ORDER BY valid_from DESC
    `);
    return stmt.all(projectId, entity, attribute);
  }

  // === Decision Operations ===

  addDecision(
    projectId: string,
    context: string,
    choice: string,
    rationale: string,
    confidence: number,
    sourceAgent: string,
    parentDecisionId?: string
  ): string {
    return this.insertDecision(projectId, {
      context,
      choice,
      rationale,
      confidence,
      source_agent: sourceAgent,
      parent_decision_id: parentDecisionId
    });
  }

  insertDecision(projectId: string, decision: Omit<DecisionRecord, 'id' | 'project_id' | 'created_at'>): string {
    const db = this.schema.getConnection(projectId);
    const id = `dec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    const stmt = db.prepare(`
      INSERT INTO decisions (id, project_id, context, choice, rationale, confidence, source_agent, parent_decision_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, projectId, decision.context, decision.choice, decision.rationale,
      decision.confidence, decision.source_agent, decision.parent_decision_id || null, now
    );

    return id;
  }

  getDecisions(projectId: string, context?: string): any[] {
    const db = this.schema.getConnection(projectId);
    let sql = 'SELECT * FROM decisions WHERE project_id = ?';
    const params: any[] = [projectId];

    if (context) {
      sql += ' AND context = ?';
      params.push(context);
    }
    sql += ' ORDER BY created_at DESC';

    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  // === Requirement Operations ===

  addRequirement(projectId: string, sourceFile: string, text: string, status?: string, priority?: number): string {
    return this.insertRequirement(projectId, {
      source_file: sourceFile,
      text,
      status: status || 'PENDING',
      priority: priority || 5
    });
  }

  insertRequirement(projectId: string, req: { id?: string; source_file?: string; text: string; status?: string; priority?: number }): string {
    const db = this.schema.getConnection(projectId);
    const id = req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    const stmt = db.prepare(`
      INSERT INTO requirements (id, project_id, source_file, text, status, priority, valid_from, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, 9999999999)
    `);
    stmt.run(
      id, projectId, req.source_file || null, req.text,
      req.status || 'PENDING', req.priority || 5, now
    );

    return id;
  }

  getRequirements(projectId: string, status?: string): any[] {
    const db = this.schema.getConnection(projectId);
    const now = Math.floor(Date.now() / 1000);
    let sql = `
      SELECT * FROM requirements 
      WHERE project_id = ? AND valid_from <= ? AND valid_until > ?
    `;
    const params: any[] = [projectId, now, now];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  // === Task Operations ===

  createTask(projectId: string, task: Omit<TaskRecord, 'id' | 'project_id' | 'created_at'>): string {
    const db = this.schema.getConnection(projectId);
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    const stmt = db.prepare(`
      INSERT INTO tasks (id, project_id, requirement_id, agent_type, status, input_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, projectId, task.requirement_id || null, task.agent_type,
      task.status || 'QUEUED', task.input_json || null, now
    );

    return id;
  }

  updateTask(taskId: string, projectId: string, updates: Partial<TaskRecord>): void {
    const db = this.schema.getConnection(projectId);
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return;

    values.push(taskId);
    const stmt = db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * Convenience method: update task by ID only (searches across all projects)
   * Note: This is slower than updateTask with projectId. Prefer the 3-arg version.
   */
  updateTaskById(taskId: string, updates: Partial<TaskRecord>): void {
    // Find which project this task belongs to by searching all databases
    const fs = require('fs');
    const path = require('path');
    const ssotDir = (this.schema as any).ssotDir;
    const files = fs.readdirSync(ssotDir).filter((f: string) => f.endsWith('.db'));
    
    for (const file of files) {
      const dbPath = path.join(ssotDir, file);
      const db = new (require('better-sqlite3'))(dbPath);
      const row = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
      if (row) {
        const projectId = row.project_id;
        db.close();
        this.updateTask(taskId, projectId, updates);
        return;
      }
      db.close();
    }
    throw new Error(`Task not found: ${taskId}`);
  }

  getTaskById(taskId: string): any | null {
    // Search across all project databases
    const fs = require('fs');
    const path = require('path');
    const ssotDir = (this.schema as any).ssotDir;
    const files = fs.readdirSync(ssotDir).filter((f: string) => f.endsWith('.db'));
    
    for (const file of files) {
      const dbPath = path.join(ssotDir, file);
      const db = new (require('better-sqlite3'))(dbPath);
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      db.close();
      if (row) return row;
    }
    return null;
  }

  getTasks(projectId: string, limit: number = 50): any[] {
    const db = this.schema.getConnection(projectId);
    const stmt = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(projectId, limit);
  }

  getRecentTasks(projectId: string, limit: number = 5): any[] {
    return this.getTasks(projectId, limit);
  }

  // === Milestone Operations ===

  addMilestone(projectId: string, name: string, criteriaJson: string): string {
    return this.createMilestone(projectId, {
      name,
      criteria_json: criteriaJson
    });
  }

  createMilestone(projectId: string, milestone: Omit<MilestoneRecord, 'id' | 'project_id'>): string {
    const db = this.schema.getConnection(projectId);
    const id = `ms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const stmt = db.prepare(`
      INSERT INTO milestones (id, project_id, name, criteria_json, git_tag)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      id, projectId, milestone.name, milestone.criteria_json,
      milestone.git_tag || null
    );

    return id;
  }

  achieveMilestone(milestoneId: string, projectId: string, evidence?: any): void {
    const db = this.schema.getConnection(projectId);
    const now = Math.floor(Date.now() / 1000);

    const stmt = db.prepare(`
      UPDATE milestones 
      SET achieved_at = ?, evidence_json = ? 
      WHERE id = ?
    `);
    stmt.run(now, evidence ? JSON.stringify(evidence) : null, milestoneId);
  }

  updateMilestone(milestoneId: string, updates: { achieved_at?: number; git_tag?: string; evidence_json?: string }): void {
    // Find which project this milestone belongs to by searching all databases
    const fs = require('fs');
    const path = require('path');
    const ssotDir = (this.schema as any).ssotDir;
    const files = fs.readdirSync(ssotDir).filter((f: string) => f.endsWith('.db'));
    
    for (const file of files) {
      const dbPath = path.join(ssotDir, file);
      const db = new (require('better-sqlite3'))(dbPath);
      const row = db.prepare('SELECT project_id FROM milestones WHERE id = ?').get(milestoneId);
      if (row) {
        const projectId = row.project_id;
        const db2 = this.schema.getConnection(projectId);
        const fields: string[] = [];
        const values: any[] = [];
        
        if (updates.achieved_at !== undefined) {
          fields.push('achieved_at = ?');
          values.push(updates.achieved_at);
        }
        if (updates.git_tag !== undefined) {
          fields.push('git_tag = ?');
          values.push(updates.git_tag);
        }
        if (updates.evidence_json !== undefined) {
          fields.push('evidence_json = ?');
          values.push(updates.evidence_json);
        }
        
        if (fields.length > 0) {
          const sql = `UPDATE milestones SET ${fields.join(', ')} WHERE id = ?`;
          values.push(milestoneId);
          db2.prepare(sql).run(...values);
        }
        db.close();
        return;
      }
      db.close();
    }
    throw new Error(`Milestone not found: ${milestoneId}`);
  }

  getMilestones(projectId: string): any[] {
    const db = this.schema.getConnection(projectId);
    const stmt = db.prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY achieved_at DESC');
    return stmt.all(projectId);
  }

  // === Fact Retrieval ===

  getFacts(projectId: string, entity: string, attribute: string): any[] {
    const db = this.schema.getConnection(projectId);
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      SELECT * FROM facts 
      WHERE project_id = ? AND entity = ? AND attribute = ? AND valid_from <= ? AND valid_until > ?
      ORDER BY valid_from DESC
    `);
    return stmt.all(projectId, entity, attribute, now, now);
  }

  getAllFacts(projectId: string, entity?: string): any[] {
    const db = this.schema.getConnection(projectId);
    const now = Math.floor(Date.now() / 1000);
    let sql = `
      SELECT * FROM facts 
      WHERE project_id = ? AND valid_from <= ? AND valid_until > ?
    `;
    const params: any[] = [projectId, now, now];
    if (entity) {
      sql += ' AND entity = ?';
      params.push(entity);
    }
    sql += ' ORDER BY valid_from DESC';
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  query(projectId: string, table: string, filters?: Record<string, any>, limit: number = 50): any[] {
    const db = this.schema.getConnection(projectId);
    
    // Whitelist allowed tables to prevent injection
    const allowedTables = ['projects', 'requirements', 'decisions', 'facts', 'tasks', 'milestones', 'provenance'];
    if (!allowedTables.includes(table)) {
      throw new Error(`Invalid table: ${table}`);
    }

    let sql = `SELECT * FROM ${table} WHERE project_id = ?`;
    const params: any[] = [projectId];

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        sql += ` AND ${key} = ?`;
        params.push(value);
      }
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  getProjectStatus(projectId: string): any {
    const db = this.schema.getConnection(projectId);
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const totalReqs = db.prepare('SELECT COUNT(*) as count FROM requirements WHERE project_id = ?').get(projectId) as { count: number };
    const pendingReqs = db.prepare("SELECT COUNT(*) as count FROM requirements WHERE project_id = ? AND status = 'PENDING'").get(projectId) as { count: number };
    const completedReqs = db.prepare("SELECT COUNT(*) as count FROM requirements WHERE project_id = ? AND status = 'COMPLETED'").get(projectId) as { count: number };
    const totalDecisions = db.prepare('SELECT COUNT(*) as count FROM decisions WHERE project_id = ?').get(projectId) as { count: number };
    const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(projectId) as { count: number };
    const completedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND status = 'COMPLETED'").get(projectId) as { count: number };

    return {
      project,
      requirements: {
        total: totalReqs?.count || 0,
        pending: pendingReqs?.count || 0,
        completed: completedReqs?.count || 0,
      },
      decisions: totalDecisions?.count || 0,
      tasks: {
        total: totalTasks?.count || 0,
        completed: completedTasks?.count || 0,
      },
    };
  }
}
