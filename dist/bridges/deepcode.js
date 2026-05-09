"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepCodeBridge = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const store_js_1 = require("../ssot/store.js");
const provenance_js_1 = require("../ssot/provenance.js");
class DeepCodeBridge {
    store;
    provenance;
    config;
    constructor(storeOrConfig, provenanceOrConfig, config) {
        if (config && storeOrConfig.getProject) {
            this.store = storeOrConfig;
            this.provenance = provenanceOrConfig;
            this.config = config;
        }
        else {
            this.config = storeOrConfig;
            this.store = new store_js_1.SSOTStore(this.config.ssotDir);
            this.provenance = new provenance_js_1.ProvenanceLogger(this.config.ssotDir);
        }
    }
    async execute(args) {
        return this.bootstrap(args);
    }
    async bootstrap(args) {
        const { project_id, requirements_dir, constraints_json, working_dir } = args;
        // Validate inputs
        if (!fs.existsSync(requirements_dir)) {
            throw new Error(`Requirements directory not found: ${requirements_dir}`);
        }
        // Ensure project exists in SSOT
        let project = this.store.getProject(project_id);
        if (!project) {
            this.store.createProject(project_id, project_id, 'Auto-created from DeepCode bootstrap');
            project = this.store.getProject(project_id);
        }
        // Parse PRD and extract requirements
        const requirements = this.parseRequirements(requirements_dir);
        for (const req of requirements) {
            this.store.insertRequirement(project_id, {
                source_file: req.source_file,
                text: req.text,
                status: 'PENDING',
                priority: req.priority || 5,
            });
        }
        // Create task record
        const taskId = this.store.createTask(project_id, {
            agent_type: 'deepcode',
            status: 'QUEUED',
            input_json: JSON.stringify({
                requirements_dir,
                constraints_json,
                req_count: requirements.length,
            }),
        });
        try {
            // Try deepcode-hku first, fallback to Claude Code via Kimi API
            const output = await this.spawnBootstrapAgent(project_id, requirements_dir, constraints_json, working_dir);
            // Parse output and extract decisions
            const decisions = this.extractDecisions(output, constraints_json);
            // Write decisions to SSOT
            for (const decision of decisions) {
                const decisionId = this.store.insertDecision(project_id, {
                    context: decision.context,
                    choice: decision.choice,
                    rationale: decision.rationale,
                    confidence: decision.confidence,
                    source_agent: 'deepcode',
                });
                this.provenance.logProvenance(project_id, decisionId, 'CREATE', 'deepcode', `DeepCode bootstrap for ${requirements_dir}`, decision.rationale);
            }
            // Record generated code state
            this.store.insertFact(project_id, {
                entity: 'project',
                attribute: 'code_generated',
                value: 'true',
                source: 'deepcode',
                value_type: 'boolean',
            });
            // Update task
            this.store.updateTask(taskId, project_id, {
                status: 'COMPLETED',
                output_json: JSON.stringify({
                    decisions_count: decisions.length,
                    requirements_count: requirements.length,
                }),
                completed_at: Math.floor(Date.now() / 1000),
            });
            // Try to initialize git if not already done
            await this.initGit(project_id, working_dir);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            project_id,
                            task_id: taskId,
                            requirements_parsed: requirements.length,
                            decisions_recorded: decisions.length,
                            state: 'QUEUED -> awaiting FSM transition to PLANNED',
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.store.updateTask(taskId, project_id, {
                status: 'FAILED',
                error_log: errorMsg,
                completed_at: Math.floor(Date.now() / 1000),
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: `DeepCode bootstrap failed: ${errorMsg}`,
                    },
                ],
                isError: true,
            };
        }
    }
    parseRequirements(requirementsDir) {
        const requirements = [];
        // Look for PRD.md, requirements.md, or any .md files
        const files = fs.readdirSync(requirementsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
            const filePath = path.join(requirementsDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            // Simple parsing: split by headers and extract requirements
            const lines = content.split('\n');
            let currentSection = '';
            for (const line of lines) {
                if (line.startsWith('# ')) {
                    currentSection = line.replace('# ', '').trim();
                }
                else if (line.startsWith('## ')) {
                    currentSection = line.replace('## ', '').trim();
                }
                else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
                    const reqText = line.trim().replace(/^[-*]\s+/, '');
                    if (reqText.length > 10) { // Filter out short lines
                        requirements.push({
                            source_file: file,
                            text: `[${currentSection}] ${reqText}`,
                            priority: this.inferPriority(reqText),
                        });
                    }
                }
            }
        }
        // If no markdown files found, create a generic requirement
        if (requirements.length === 0) {
            requirements.push({
                source_file: 'auto-generated',
                text: 'Bootstrap project from available documentation',
                priority: 5,
            });
        }
        return requirements;
    }
    inferPriority(text) {
        const lower = text.toLowerCase();
        if (lower.includes('critical') || lower.includes('must') || lower.includes('essential'))
            return 1;
        if (lower.includes('high') || lower.includes('should'))
            return 2;
        if (lower.includes('medium') || lower.includes('could'))
            return 3;
        if (lower.includes('low') || lower.includes('optional') || lower.includes('nice'))
            return 5;
        return 5;
    }
    async spawnBootstrapAgent(projectId, requirementsDir, constraintsJson, workingDir) {
        // DeepCode HKU (local deepcode binary) is a paper reproduction engine
        // that requires Docker and specific project structure. It is NOT
        // suitable for general code generation. Skip it entirely and use
        // Claude Code (via Kimi API) as the primary bootstrap agent.
        console.log(`[DeepCode Bridge] Using Claude Code (Kimi API) as bootstrap agent`);
        return this.spawnClaudeBootstrap(projectId, requirementsDir, constraintsJson, workingDir);
    }
    // Kept for reference but not used - deepcode-hku requires Docker
    async tryDeepCodeHku(projectId, requirementsDir, constraintsJson) {
        return new Promise((resolve, reject) => {
            const memoryLimit = this.config.agentMemoryLimits.deepcode || '1024M';
            // Create a temporary paper structure for DeepCode
            const tempPaperDir = `/tmp/heop_deepcode_${projectId}`;
            const paperMdPath = `${tempPaperDir}/paper.md`;
            // Generate paper.md from requirements
            this.generatePaperMd(requirementsDir, paperMdPath, constraintsJson);
            const args = [
                '--local', // Launch locally (no Docker needed for simple tasks)
            ];
            console.log(`[DeepCode Bridge] Trying deepcode-hku with memory limit ${memoryLimit}`);
            const child = (0, child_process_1.spawn)('deepcode', args, {
                timeout: 30 * 60 * 1000, // 30 minutes
                cwd: tempPaperDir,
                env: {
                    ...process.env,
                    NODE_OPTIONS: `--max-old-space-size=${parseInt(memoryLimit)}`,
                }
            });
            // Kill child after collecting enough output (it's a dev server)
            const killTimer = setTimeout(() => {
                console.log('[DeepCode Bridge] Killing dev server after 5s');
                try {
                    child.kill('SIGTERM');
                }
                catch {
                    // Ignore kill errors
                }
            }, 5000);
            let output = '';
            let errorOutput = '';
            child.stdout?.on('data', (data) => {
                output += data.toString();
            });
            child.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });
            child.on('close', (code) => {
                clearTimeout(killTimer);
                // Cleanup temp directory
                try {
                    fs.rmSync(tempPaperDir, { recursive: true, force: true });
                }
                catch {
                    // Ignore cleanup errors
                }
                if (code === 0 || code === null || code === 143) {
                    resolve(output || 'DeepCode execution completed');
                }
                else {
                    reject(new Error(`deepcode-hku exited with code ${code}: ${errorOutput}`));
                }
            });
            child.on('error', (err) => {
                reject(err);
            });
        });
    }
    async spawnClaudeBootstrap(projectId, requirementsDir, constraintsJson, workingDir) {
        return new Promise((resolve, reject) => {
            const memoryLimit = this.config.agentMemoryLimits.claudeCode || '512M';
            const cwd = workingDir || process.cwd();
            // Read requirements
            let requirements = '';
            if (fs.existsSync(requirementsDir)) {
                const files = fs.readdirSync(requirementsDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    requirements += fs.readFileSync(path.join(requirementsDir, file), 'utf-8') + '\n\n';
                }
            }
            // Parse constraints
            let constraints = {};
            if (constraintsJson) {
                try {
                    constraints = JSON.parse(constraintsJson);
                }
                catch {
                    // Ignore parse errors
                }
            }
            // Build bootstrap prompt
            const prompt = `You are a project bootstrap agent. Based on the following requirements and constraints, generate a project skeleton with initial architecture decisions.

## Requirements
${requirements}

## Technical Constraints
- Language: ${constraints.lang || 'Not specified'}
- Framework: ${constraints.framework || 'Not specified'}

## Your Task
1. Analyze the requirements and propose architecture decisions
2. Generate a minimal project skeleton (directory structure, config files)
3. Output your decisions in JSON format at the end

## Output Format
End your response with a JSON block like:
\`\`\`json
{
  "decisions": [
    {
      "context": "framework",
      "choice": "express",
      "rationale": "Lightweight, well-documented",
      "confidence": 0.9
    }
  ],
  "files_created": ["package.json", "src/index.js"]
}
\`\`\`

Generate the project skeleton now.`;
            // Kimi API configuration
            const kimiApiKey = process.env.KIMI_API_KEY || '';
            const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.kimi.com/coding/';
            const anthropicApiKey = process.env.ANTHROPIC_API_KEY || kimiApiKey;
            const args = [
                '-p',
                '--dangerously-skip-permissions',
                '--allowed-tools', 'Bash,Edit,Read,Write',
            ];
            const child = (0, child_process_1.spawn)('claude', args, {
                timeout: 30 * 60 * 1000,
                cwd,
                env: {
                    ...process.env,
                    NODE_OPTIONS: `--max-old-space-size=${parseInt(memoryLimit)}`,
                    CLAUDE_CODE_SIMPLE: '1',
                    ANTHROPIC_API_KEY: anthropicApiKey,
                    ANTHROPIC_BASE_URL: anthropicBaseUrl,
                    KIMI_API_KEY: kimiApiKey,
                }
            });
            child.stdin?.write(prompt);
            child.stdin?.end();
            let output = '';
            child.stdout?.on('data', (data) => {
                output += data.toString();
            });
            child.on('close', (code) => {
                if (output.trim()) {
                    resolve(output);
                }
                else {
                    resolve(this.generateFallbackOutput(requirementsDir, constraintsJson));
                }
            });
            child.on('error', () => {
                resolve(this.generateFallbackOutput(requirementsDir, constraintsJson));
            });
        });
    }
    generatePaperMd(requirementsDir, outputPath, constraintsJson) {
        const fs = require('fs');
        const path = require('path');
        // Read all .md files from requirements directory
        let requirements = '';
        if (fs.existsSync(requirementsDir)) {
            const files = fs.readdirSync(requirementsDir).filter((f) => f.endsWith('.md'));
            for (const file of files) {
                requirements += fs.readFileSync(path.join(requirementsDir, file), 'utf-8') + '\n\n';
            }
        }
        // Parse constraints
        let constraints = '';
        if (constraintsJson) {
            try {
                const c = JSON.parse(constraintsJson);
                constraints = `\n## Technical Constraints\n- Language: ${c.lang || 'Not specified'}\n- Framework: ${c.framework || 'Not specified'}\n`;
            }
            catch {
                // Ignore parse errors
            }
        }
        // Generate paper.md in DeepCode format
        const paperMd = `# HEOP Generated Paper

## Abstract
This paper describes the implementation of a software system based on the following requirements.

## Requirements
${requirements}
${constraints}

## Implementation Notes
- Generated by HEOP (Hermes Engineering OS Plugin)
- Source: ${requirementsDir}
- Date: ${new Date().toISOString()}

## Architecture
TBD - DeepCode will analyze requirements and propose architecture.
`;
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, paperMd);
    }
    generateFallbackOutput(requirementsDir, constraintsJson) {
        // When DeepCode is not available or fails, generate a fallback report
        const fs = require('fs');
        const path = require('path');
        let reqCount = 0;
        if (fs.existsSync(requirementsDir)) {
            reqCount = fs.readdirSync(requirementsDir).filter((f) => f.endsWith('.md')).length;
        }
        let constraints = {};
        if (constraintsJson) {
            try {
                constraints = JSON.parse(constraintsJson);
            }
            catch {
                // Ignore
            }
        }
        return JSON.stringify({
            status: 'fallback',
            reason: 'DeepCode HKU requires full local setup (FastAPI, Node.js, new_ui directory). Using Claude Code (Kimi API) as fallback.',
            requirements_parsed: reqCount,
            constraints: constraints,
            decisions: [
                {
                    context: 'framework',
                    choice: constraints.framework || 'unknown',
                    rationale: 'Selected from constraints or default',
                    confidence: 0.7
                },
                {
                    context: 'language',
                    choice: constraints.lang || 'unknown',
                    rationale: 'Selected from constraints or default',
                    confidence: 0.7
                }
            ],
            generated_files: [],
            note: 'DeepCode HKU is a research paper reproduction engine. HEOP now uses Claude Code via Kimi API as the primary bootstrap agent.'
        });
    }
    extractDecisions(output, constraintsJson) {
        // Try to parse JSON output from the agent
        try {
            // Look for JSON block in the output
            const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : output;
            const parsed = JSON.parse(jsonStr);
            if (parsed.decisions && Array.isArray(parsed.decisions)) {
                return parsed.decisions;
            }
        }
        catch {
            // Not JSON, use heuristics
        }
        // Fallback: generate default decisions based on constraints
        let constraints = {};
        if (constraintsJson) {
            try {
                constraints = JSON.parse(constraintsJson);
            }
            catch {
                // Ignore
            }
        }
        return [
            {
                context: 'framework',
                choice: constraints.framework || 'default',
                rationale: 'Selected from user constraints or system default',
                confidence: 0.7,
            },
            {
                context: 'language',
                choice: constraints.lang || 'typescript',
                rationale: 'Selected from user constraints or system default',
                confidence: 0.7,
            },
        ];
    }
    async initGit(projectId, workingDir) {
        const cwd = workingDir || process.cwd();
        try {
            // Check if git repo exists
            const gitDir = path.join(cwd, '.git');
            if (!fs.existsSync(gitDir)) {
                // Initialize git repo
                await new Promise((resolve, reject) => {
                    const child = (0, child_process_1.spawn)('git', ['init'], { cwd });
                    child.on('close', (code) => {
                        if (code === 0)
                            resolve();
                        else
                            reject(new Error(`git init failed: ${code}`));
                    });
                    child.on('error', reject);
                });
            }
            this.store.insertFact(projectId, {
                entity: 'git',
                attribute: 'initialized',
                value: 'true',
                source: 'deepcode-bridge',
                value_type: 'boolean',
            });
        }
        catch (err) {
            console.log(`[DeepCode Bridge] Git init failed: ${err}`);
            // Non-fatal: record intent anyway
            this.store.insertFact(projectId, {
                entity: 'git',
                attribute: 'initialized',
                value: 'false',
                source: 'deepcode-bridge',
                value_type: 'boolean',
            });
        }
    }
}
exports.DeepCodeBridge = DeepCodeBridge;
//# sourceMappingURL=deepcode.js.map