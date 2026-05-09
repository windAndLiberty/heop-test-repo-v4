# HEOP - Hermes Engineering OS Plugin

**HEOP** (Hermes Engineering OS Plugin) is a plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent) that transforms it from a personal assistant into an **autonomous software engineering operating system**.

It implements **Single Source of Truth (SSOT)** architecture for coordinating multiple AI agents (Hermes + Claude Code + DeepCode) in software engineering workflows.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Hermes Agent (Core)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Planner   │  │   Memory    │  │  Skill Management   │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────┘ │
│         │                                                   │
│         ▼  MCP Tools                                        │
│  ┌────────────────────────────────────────────────────────┐│
│  │              HEOP Plugin (This Project)                ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  ││
│  │  │ SSOT Core│ │Lifecycle │ │  Agent   │ │Git/Issue │  ││
│  │  │(SQLite)  │ │  Engine  │ │ Bridges  │ │Automation│  ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  ││
│  │  ┌────────────────────────────────────────────────────┐  ││
│  │  │        XAI Provenance Logger                     │  ││
│  │  └────────────────────────────────────────────────────┘  ││
│  └────────────────────────────────────────────────────────┘│
│         │                                                   │
│    ┌────┴────┐                                              │
│    ▼         ▼                                              │
│ ┌──────┐  ┌──────┐                                         │
│ │DeepCode│  │Claude│                                         │
│ │(Cold) │  │ Code │                                         │
│ │Start  │  │(Incr)│                                         │
│ └──────┘  └──────┘                                         │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. SSOT Core (Single Source of Truth)

SQLite + JSON1 extension database storing:

- **projects** — Project master table with state tracking
- **requirements** — Immutable requirements (append-only with time windows)
- **decisions** — Architecture decisions with rationale, confidence, source agent
- **facts** — Entity-Attribute-Value store for dynamic state
- **tasks** — Execution logs with full input/output/error history
- **milestones** — Milestone definitions with achievement criteria
- **provenance** — Origin tracking for every fact (XAI)

### 2. Lifecycle Engine (FSM)

Finite State Machine managing project lifecycle:

```
CREATED → PLANNED → BOOTSTRAPPED → INCREMENTAL_DEV → TESTING → DELIVERED → ARCHIVED
```

- Automatic state transitions based on task completion
- Side effects: Git tagging, Issue creation, milestone achievement
- Registered on Hermes `post-task-hook`

### 3. Agent Bridges

**DeepCode Bridge** (Cold Start):
- Spawns isolated DeepCode process (1G memory limit, 30min timeout)
- Parses PRD → requirements
- Extracts architecture decisions → SSOT
- Git init + initial commit

**Claude Code Bridge** (Incremental):
- Spawns isolated Claude Code CLI (512M memory limit, 60min timeout)
- Assembles context package from SSOT (read-only decisions)
- Applies diffs, runs tests, records coverage
- Prevents local optimization from breaking global architecture

### 4. Git & Issue Automation

- **Conventional Commits** with SSOT references (decisions, requirements, tasks)
- **Automatic tagging** on milestone achievement
- **Structured Issues** created on task failure with full context

### 5. XAI Provenance Logger

Records for every fact:
- Operation (CREATE / INVALIDATE / UPDATE)
- Actor (deepcode / claude / hermes / human)
- Input context and reasoning chain
- Timestamp

Enables answering: *"Why was PostgreSQL chosen over MySQL?"*

## MCP Tools Exposed

| Tool | Purpose |
|------|---------|
| `deepcode_bootstrap` | Cold-start project from PRD |
| `claude_code_execute` | Incremental development task |
| `ssot_query` | Query single source of truth |
| `git_milestone_commit` | Auto-commit with SSOT references |
| `github_create_structured_issue` | Create issue from failure context |
| `project_status` | Get project health summary |

## Installation

```bash
# Clone into Hermes plugins directory
cd ~/.hermes/plugins
git clone https://github.com/your-org/engineering-os.git

# Install dependencies
cd engineering-os
npm install

# Build
npm run build

# Register in hermes.config.js
cp hermes.config.js ~/.hermes/config.js  # or merge into existing config
```

## Configuration

```javascript
// ~/.hermes/config.js
export default {
  plugins: [
    {
      name: 'engineering-os',
      entry: './plugins/engineering-os/dist/index.js',
      config: {
        ssotDir: '~/.hermes/ssot-data',
        gitAutoCommit: true,
        issueProvider: 'github',
        maxConcurrentAgents: 1,
        agentMemoryLimits: {
          deepcode: '1024M',
          claudeCode: '512M'
        }
      }
    }
  ]
};
```

## Usage Example

```
# Bootstrap new project
User: "Create e-commerce API from ~/projects/shop/PRD.md"
Hermes: [Calls deepcode_bootstrap]
        → Project created in SSOT
        → DeepCode generates skeleton
        → Decisions recorded
        → Git repo initialized
        → Tagged v0.1.0-skeleton

# Incremental development
User: "Add OAuth2 authentication"
Hermes: [Calls claude_code_execute with SSOT context]
        → Claude Code receives architecture decisions
        → Implements feature
        → Tests pass (87% coverage)
        → Committed with decision references
        → FSM evaluates milestone
```

## Project Structure

```
├── src/
│   ├── index.ts              # Plugin entry, MCP Tools registration
│   ├── ssot/
│   │   ├── schema.ts         # SQLite schema
│   │   ├── store.ts          # Fact CRUD (immutable append)
│   │   └── provenance.ts     # Origin tracking
│   ├── lifecycle/
│   │   ├── fsm.ts            # State machine
│   │   └── transitions.ts    # Transition rules
│   ├── bridges/
│   │   ├── deepcode.ts       # DeepCode CLI wrapper
│   │   └── claude-code.ts    # Claude Code CLI wrapper
│   ├── automation/
│   │   ├── git.ts            # Git automation
│   │   └── issue.ts          # Issue automation
│   └── skills/               # Dynamic skill templates
│       ├── bootstrap-project.yml
│       └── incremental-dev.yml
├── hermes.config.js          # Example configuration
├── package.json
└── tsconfig.json
```

## Why Plugin + Skill?

| Capability | Pure Skill | Plugin + Skill |
|-----------|------------|----------------|
| Cross-session persistence | ❌ | ✅ SQLite |
| Transactional state machine | ❌ | ✅ FSM |
| Immutable fact append | ❌ | ✅ Event sourcing |
| Git/Issue automation | ⚠️ | ✅ Native MCP |
| XAI decision chain | ❌ | ✅ Provenance |
| Resource isolation | ❌ | ✅ Sub-agent limits |
| Self-evolution | ⚠️ | ✅ Dynamic skill generation |

**Plugin** provides "authoritative storage of facts and state".  
**Skill** provides "strategy templates for task execution".  
Both are necessary.

## License

MIT
