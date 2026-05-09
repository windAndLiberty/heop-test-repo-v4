"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSOTStore = void 0;
const schema_js_1 = require("./schema.js");
class SSOTStore {
    schema;
    constructor(schemaOrDir) {
        if (typeof schemaOrDir === 'string') {
            this.schema = new schema_js_1.SchemaManager(schemaOrDir);
        }
        else {
            this.schema = schemaOrDir;
        }
    }
    // === Project Operations ===
    createProject(projectId, name, goal) {
        this.schema.initializeProject(projectId, name, goal);
    }
    getProject(projectId) {
        const db = this.schema.getConnection(projectId);
        const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
        return stmt.get(projectId);
    }
    updateProjectState(projectId, newState) {
        const db = this.schema.getConnection(projectId);
        const stmt = db.prepare(`
      UPDATE projects 
      SET state = ?, updated_at = unixepoch() 
      WHERE id = ?
    `);
        stmt.run(newState, projectId);
    }
    // === Immutable Fact Operations ===
    addFact(projectId, entity, attribute, value, valueType, confidence, source) {
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
    insertFact(projectId, fact) {
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
            insertStmt.run(id, projectId, fact.entity, fact.attribute, fact.value, fact.value_type || 'string', fact.confidence ?? 1.0, fact.source || 'unknown', now);
        })();
        return id;
    }
    getCurrentFacts(projectId, entity, attribute) {
        const db = this.schema.getConnection(projectId);
        const now = Math.floor(Date.now() / 1000);
        let sql = `
      SELECT * FROM facts 
      WHERE project_id = ? AND valid_from <= ? AND valid_until > ?
    `;
        const params = [projectId, now, now];
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
    getFactHistory(projectId, entity, attribute) {
        const db = this.schema.getConnection(projectId);
        const stmt = db.prepare(`
      SELECT * FROM facts 
      WHERE project_id = ? AND entity = ? AND attribute = ?
      ORDER BY valid_from DESC
    `);
        return stmt.all(projectId, entity, attribute);
    }
    // === Decision Operations ===
    addDecision(projectId, context, choice, rationale, confidence, sourceAgent, parentDecisionId) {
        return this.insertDecision(projectId, {
            context,
            choice,
            rationale,
            confidence,
            source_agent: sourceAgent,
            parent_decision_id: parentDecisionId
        });
    }
    insertDecision(projectId, decision) {
        const db = this.schema.getConnection(projectId);
        const id = `dec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      INSERT INTO decisions (id, project_id, context, choice, rationale, confidence, source_agent, parent_decision_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, projectId, decision.context, decision.choice, decision.rationale, decision.confidence, decision.source_agent, decision.parent_decision_id || null, now);
        return id;
    }
    getDecisions(projectId, context) {
        const db = this.schema.getConnection(projectId);
        let sql = 'SELECT * FROM decisions WHERE project_id = ?';
        const params = [projectId];
        if (context) {
            sql += ' AND context = ?';
            params.push(context);
        }
        sql += ' ORDER BY created_at DESC';
        const stmt = db.prepare(sql);
        return stmt.all(...params);
    }
    // === Requirement Operations ===
    addRequirement(projectId, sourceFile, text, status, priority) {
        return this.insertRequirement(projectId, {
            source_file: sourceFile,
            text,
            status: status || 'PENDING',
            priority: priority || 5
        });
    }
    insertRequirement(projectId, req) {
        const db = this.schema.getConnection(projectId);
        const id = req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      INSERT INTO requirements (id, project_id, source_file, text, status, priority, valid_from, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, 9999999999)
    `);
        stmt.run(id, projectId, req.source_file || null, req.text, req.status || 'PENDING', req.priority || 5, now);
        return id;
    }
    getRequirements(projectId, status) {
        const db = this.schema.getConnection(projectId);
        const now = Math.floor(Date.now() / 1000);
        let sql = `
      SELECT * FROM requirements 
      WHERE project_id = ? AND valid_from <= ? AND valid_until > ?
    `;
        const params = [projectId, now, now];
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        const stmt = db.prepare(sql);
        return stmt.all(...params);
    }
    // === Task Operations ===
    createTask(projectId, task) {
        const db = this.schema.getConnection(projectId);
        const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      INSERT INTO tasks (id, project_id, requirement_id, agent_type, status, input_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, projectId, task.requirement_id || null, task.agent_type, task.status || 'QUEUED', task.input_json || null, now);
        return id;
    }
    updateTask(taskId, projectId, updates) {
        const db = this.schema.getConnection(projectId);
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        if (fields.length === 0)
            return;
        values.push(taskId);
        const stmt = db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`);
        stmt.run(...values);
    }
    /**
     * Convenience method: update task by ID only (searches across all projects)
     * Note: This is slower than updateTask with projectId. Prefer the 3-arg version.
     */
    updateTaskById(taskId, updates) {
        // Find which project this task belongs to by searching all databases
        const fs = require('fs');
        const path = require('path');
        const ssotDir = this.schema.ssotDir;
        const files = fs.readdirSync(ssotDir).filter((f) => f.endsWith('.db'));
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
    getTaskById(taskId) {
        // Search across all project databases
        const fs = require('fs');
        const path = require('path');
        const ssotDir = this.schema.ssotDir;
        const files = fs.readdirSync(ssotDir).filter((f) => f.endsWith('.db'));
        for (const file of files) {
            const dbPath = path.join(ssotDir, file);
            const db = new (require('better-sqlite3'))(dbPath);
            const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
            db.close();
            if (row)
                return row;
        }
        return null;
    }
    getTasks(projectId, limit = 50) {
        const db = this.schema.getConnection(projectId);
        const stmt = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?');
        return stmt.all(projectId, limit);
    }
    getRecentTasks(projectId, limit = 5) {
        return this.getTasks(projectId, limit);
    }
    // === Milestone Operations ===
    addMilestone(projectId, name, criteriaJson) {
        return this.createMilestone(projectId, {
            name,
            criteria_json: criteriaJson
        });
    }
    createMilestone(projectId, milestone) {
        const db = this.schema.getConnection(projectId);
        const id = `ms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const stmt = db.prepare(`
      INSERT INTO milestones (id, project_id, name, criteria_json, git_tag)
      VALUES (?, ?, ?, ?, ?)
    `);
        stmt.run(id, projectId, milestone.name, milestone.criteria_json, milestone.git_tag || null);
        return id;
    }
    achieveMilestone(milestoneId, projectId, evidence) {
        const db = this.schema.getConnection(projectId);
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      UPDATE milestones 
      SET achieved_at = ?, evidence_json = ? 
      WHERE id = ?
    `);
        stmt.run(now, evidence ? JSON.stringify(evidence) : null, milestoneId);
    }
    updateMilestone(milestoneId, updates) {
        // Find which project this milestone belongs to by searching all databases
        const fs = require('fs');
        const path = require('path');
        const ssotDir = this.schema.ssotDir;
        const files = fs.readdirSync(ssotDir).filter((f) => f.endsWith('.db'));
        for (const file of files) {
            const dbPath = path.join(ssotDir, file);
            const db = new (require('better-sqlite3'))(dbPath);
            const row = db.prepare('SELECT project_id FROM milestones WHERE id = ?').get(milestoneId);
            if (row) {
                const projectId = row.project_id;
                const db2 = this.schema.getConnection(projectId);
                const fields = [];
                const values = [];
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
    getMilestones(projectId) {
        const db = this.schema.getConnection(projectId);
        const stmt = db.prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY achieved_at DESC');
        return stmt.all(projectId);
    }
    // === Fact Retrieval ===
    getFacts(projectId, entity, attribute) {
        const db = this.schema.getConnection(projectId);
        const now = Math.floor(Date.now() / 1000);
        const stmt = db.prepare(`
      SELECT * FROM facts 
      WHERE project_id = ? AND entity = ? AND attribute = ? AND valid_from <= ? AND valid_until > ?
      ORDER BY valid_from DESC
    `);
        return stmt.all(projectId, entity, attribute, now, now);
    }
    getAllFacts(projectId, entity) {
        const db = this.schema.getConnection(projectId);
        const now = Math.floor(Date.now() / 1000);
        let sql = `
      SELECT * FROM facts 
      WHERE project_id = ? AND valid_from <= ? AND valid_until > ?
    `;
        const params = [projectId, now, now];
        if (entity) {
            sql += ' AND entity = ?';
            params.push(entity);
        }
        sql += ' ORDER BY valid_from DESC';
        const stmt = db.prepare(sql);
        return stmt.all(...params);
    }
    query(projectId, table, filters, limit = 50) {
        const db = this.schema.getConnection(projectId);
        // Whitelist allowed tables to prevent injection
        const allowedTables = ['projects', 'requirements', 'decisions', 'facts', 'tasks', 'milestones', 'provenance'];
        if (!allowedTables.includes(table)) {
            throw new Error(`Invalid table: ${table}`);
        }
        let sql = `SELECT * FROM ${table} WHERE project_id = ?`;
        const params = [projectId];
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
    getProjectStatus(projectId) {
        const db = this.schema.getConnection(projectId);
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        const totalReqs = db.prepare('SELECT COUNT(*) as count FROM requirements WHERE project_id = ?').get(projectId);
        const pendingReqs = db.prepare("SELECT COUNT(*) as count FROM requirements WHERE project_id = ? AND status = 'PENDING'").get(projectId);
        const completedReqs = db.prepare("SELECT COUNT(*) as count FROM requirements WHERE project_id = ? AND status = 'COMPLETED'").get(projectId);
        const totalDecisions = db.prepare('SELECT COUNT(*) as count FROM decisions WHERE project_id = ?').get(projectId);
        const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(projectId);
        const completedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND status = 'COMPLETED'").get(projectId);
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
exports.SSOTStore = SSOTStore;
//# sourceMappingURL=store.js.map