const { SchemaManager, SSOTStore, ProvenanceLogger, DeepCodeBridge, ClaudeCodeBridge } = require('./dist');
const fs = require('fs');
const path = require('path');

console.log('=== Real Agent Integration Test ===\n');

const testDir = '/tmp/heop-agent-test';
fs.mkdirSync(testDir, { recursive: true });

// Initialize project
const schema = new SchemaManager(testDir);
schema.initializeProject('agent-test', 'Agent Integration Test', 'Test real DeepCode and Claude Code');
const store = new SSOTStore(testDir);
const prov = new ProvenanceLogger(testDir);

// Add requirements
store.addRequirement('agent-test', 'PRD.md', 'Create a simple Python CLI calculator', 'PENDING', 1);

// Test 1: Real DeepCode call
console.log('[TEST 1] DeepCode Bridge - Real Call');
const deepcode = new DeepCodeBridge({
  ssotDir: testDir,
  maxConcurrentAgents: 1,
  agentMemoryLimits: { deepcode: '1024M', claudeCode: '512M' }
});

const reqDir = path.join(testDir, 'requirements');
fs.mkdirSync(reqDir, { recursive: true });
fs.writeFileSync(path.join(reqDir, 'PRD.md'), '# Calculator App\n\nCreate a simple Python CLI calculator supporting +, -, *, /');

(async () => {
  try {
    const result = await deepcode.bootstrap({
      project_id: 'agent-test',
      requirements_dir: reqDir,
      constraints_json: JSON.stringify({ lang: 'python', framework: 'cli' })
    });
    console.log('  DeepCode result:', JSON.stringify(result, null, 2).substring(0, 500));
    console.log('  ✓ DeepCode call completed\n');
  } catch (err) {
    console.log('  ✗ DeepCode error:', err.message, '\n');
  }

  // Test 2: Real Claude Code call (direct mode, not -p)
  console.log('[TEST 2] Claude Code Bridge - Real Call (direct mode)');
  const claude = new ClaudeCodeBridge({
    ssotDir: testDir,
    maxConcurrentAgents: 1,
    agentMemoryLimits: { deepcode: '1024M', claudeCode: '512M' }
  });

  try {
    const result = await claude.execute({
      project_id: 'agent-test',
      task_id: 'task_test_001',
      goal: 'Write a simple Python function add(a, b) that returns a+b. Save to /tmp/heop-agent-test/calc.py',
      context_facts_query: 'SELECT * FROM facts WHERE project_id = "agent-test"',
      readonly_files: []
    });
    console.log('  Claude Code result:', JSON.stringify(result, null, 2).substring(0, 500));
    
    const calcPath = '/tmp/heop-agent-test/calc.py';
    if (fs.existsSync(calcPath)) {
      console.log('  ✓ File created:', calcPath);
      console.log('  Content:', fs.readFileSync(calcPath, 'utf8').substring(0, 200));
    } else {
      console.log('  ⚠ File not created');
    }
    console.log('  ✓ Claude Code call completed\n');
  } catch (err) {
    console.log('  ✗ Claude Code error:', err.message, '\n');
  }

  console.log('=== Real Agent Integration Test Complete ===');
})();
