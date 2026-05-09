const { SchemaManager, SSOTStore, ProvenanceLogger, LifecycleEngine, DeepCodeBridge, ClaudeCodeBridge, GitAutomation, IssueAutomation } = require('./dist');

console.log('=== HEOP Real Integration Test Suite ===\n');

const TEST_DIR = '/tmp/heop-real-test';
const SSOT_DIR = '/tmp/heop-real-test-ssot';

// Clean up
const fs = require('fs');
if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
if (fs.existsSync(SSOT_DIR)) fs.rmSync(SSOT_DIR, { recursive: true });
fs.mkdirSync(TEST_DIR, { recursive: true });
fs.mkdirSync(SSOT_DIR, { recursive: true });

// Test 1: Git Real Commit
console.log('[TEST 1] GitAutomation - REAL git commit');
const schema = new SchemaManager(SSOT_DIR);
schema.initializeProject('real-test', 'Real Integration Test');
const store = new SSOTStore(SSOT_DIR);

// Create a real file to commit
fs.writeFileSync(`${TEST_DIR}/hello.txt`, 'Hello from HEOP real test!');

const git = new GitAutomation(store, {
  ssotDir: SSOT_DIR,
  gitAutoCommit: true,
  issueProvider: 'github',
  maxConcurrentAgents: 1,
  agentMemoryLimits: { deepcode: '1024M', claudeCode: '512M' }
});

// Add a decision and task for commit message
store.addDecision('real-test', 'test-framework', 'jest', 'Standard JS testing', 0.9, 'deepcode');
const taskId = store.createTask('real-test', {
  agent_type: 'claude',
  status: 'COMPLETED',
  input_json: JSON.stringify({ goal: 'setup project' }),
});

git.milestoneCommit({
  project_id: 'real-test',
  message_prefix: 'feat(test)',
  milestone_name: 'Initial Setup',
  working_dir: TEST_DIR
}).then(result => {
  console.log('  Result:', JSON.parse(result.content[0].text));
  
  // Verify git log
  const { execSync } = require('child_process');
  try {
    const log = execSync('git log --oneline -1', { cwd: TEST_DIR }).toString().trim();
    console.log('  Git log:', log);
    console.log('  ✓ REAL git commit verified\n');
  } catch (e) {
    console.log('  ✗ Git log failed:', e.message);
  }
  
  // Test 2: DeepCode Bridge with Claude fallback
  console.log('[TEST 2] DeepCodeBridge - Claude fallback bootstrap');
  
  // Create a fake PRD
  const prdDir = `${TEST_DIR}/docs`;
  fs.mkdirSync(prdDir, { recursive: true });
  fs.writeFileSync(`${prdDir}/PRD.md`, `# Test Project\n\n## Requirements\n- Must have user authentication\n- Must support OAuth2 login\n- Should use SQLite database\n`);
  
  const deepcode = new DeepCodeBridge({
    ssotDir: SSOT_DIR,
    gitAutoCommit: true,
    issueProvider: 'github',
    maxConcurrentAgents: 1,
    agentMemoryLimits: { deepcode: '1024M', claudeCode: '512M' }
  });
  
  // This will try deepcode-hku (fail) then fallback to Claude via Kimi API
  // But we need env vars set - let's check
  const hasKimiKey = !!process.env.KIMI_API_KEY;
  console.log('  KIMI_API_KEY available:', hasKimiKey);
  
  if (hasKimiKey) {
    deepcode.execute({
      project_id: 'real-test',
      requirements_dir: prdDir,
      constraints_json: JSON.stringify({ lang: 'typescript', framework: 'fastify' }),
      working_dir: TEST_DIR
    }).then(dcResult => {
      console.log('  DeepCode result:', JSON.parse(dcResult.content[0].text));
      console.log('  ✓ DeepCode bridge completed\n');
      
      runClaudeTest();
    }).catch(err => {
      console.log('  DeepCode error:', err.message);
      runClaudeTest();
    });
  } else {
    console.log('  ⚠ Skipping live DeepCode test (no KIMI_API_KEY)\n');
    runClaudeTest();
  }
});

function runClaudeTest() {
  // Test 3: Claude Code Bridge with Kimi API
  console.log('[TEST 3] ClaudeCodeBridge - Kimi API execution');
  
  const hasKimiKey = !!process.env.KIMI_API_KEY;
  console.log('  KIMI_API_KEY available:', hasKimiKey);
  
  if (hasKimiKey) {
    // Ensure project is in BOOTSTRAPPED state
    store.updateProjectState('real-test', 'BOOTSTRAPPED');
    store.insertFact('real-test', {
      entity: 'project',
      attribute: 'state',
      value: 'BOOTSTRAPPED',
      source: 'test',
      value_type: 'string'
    });
    
    const claude = new ClaudeCodeBridge({
      ssotDir: SSOT_DIR,
      gitAutoCommit: true,
      issueProvider: 'github',
      maxConcurrentAgents: 1,
      agentMemoryLimits: { deepcode: '1024M', claudeCode: '512M' }
    });
    
    claude.execute({
      project_id: 'real-test',
      task_id: 'task_claude_001',
      goal: 'Create a simple README.md file in the project directory',
      working_dir: TEST_DIR
    }).then(ccResult => {
      console.log('  Claude result:', JSON.parse(ccResult.content[0].text));
      
      // Check if README was created
      const readmePath = `${TEST_DIR}/README.md`;
      if (fs.existsSync(readmePath)) {
        console.log('  README.md created!');
        console.log('  Content preview:', fs.readFileSync(readmePath, 'utf-8').substring(0, 100));
        console.log('  ✓ Claude Code REAL execution verified\n');
      } else {
        console.log('  ⚠ README.md not created (may need retry)\n');
      }
      
      finalize();
    }).catch(err => {
      console.log('  Claude error:', err.message);
      finalize();
    });
  } else {
    console.log('  ⚠ Skipping live Claude test (no KIMI_API_KEY)\n');
    finalize();
  }
}

function finalize() {
  console.log('=== Integration Tests Complete ===');
  console.log('Test directory:', TEST_DIR);
  console.log('SSOT directory:', SSOT_DIR);
  
  // List all files in test dir
  const files = fs.readdirSync(TEST_DIR, { recursive: true });
  console.log('Files created:', files);
}
