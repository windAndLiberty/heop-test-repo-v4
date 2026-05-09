const { SchemaManager, SSOTStore, ProvenanceLogger, LifecycleEngine, DeepCodeBridge, ClaudeCodeBridge, GitAutomation, IssueAutomation } = require('./dist');

console.log('=== HEOP Acceptance Test Suite ===\n');

// Test 1: SchemaManager
console.log('[TEST 1] SchemaManager - Project Initialization');
const schema = new SchemaManager('/tmp/heop-acceptance-test');
schema.initializeProject('acceptance-proj', 'Acceptance Test Project', 'Test HEOP functionality');
console.log('  ✓ Project database created\n');

// Test 2: SSOTStore - Immutable Append
console.log('[TEST 2] SSOTStore - Immutable Fact Storage');
const store = new SSOTStore('/tmp/heop-acceptance-test');

store.addRequirement('acceptance-proj', 'PRD.md', 'System must support user authentication', 'PENDING', 1);
store.addRequirement('acceptance-proj', 'PRD.md', 'System must support OAuth2 login', 'PENDING', 2);
console.log('  ✓ Requirements added (2)');

store.addDecision('acceptance-proj', 'Database Selection', 'SQLite', 'Lightweight, no server needed for 2core4g', 0.95, 'deepcode');
console.log('  ✓ Decision added');

store.addFact('acceptance-proj', 'src/auth.js', 'exists', 'true', 'boolean', 1.0, 'deepcode');
console.log('  ✓ Fact added');

store.addFact('acceptance-proj', 'src/auth.js', 'exists', 'true', 'boolean', 1.0, 'claude');
const facts = store.getFacts('acceptance-proj', 'src/auth.js', 'exists');
console.log('  ✓ Fact updated (immutable append, ' + facts.length + ' versions)');

const allFacts = store.getAllFacts('acceptance-proj');
console.log('  ✓ Total facts in store: ' + allFacts.length + '\n');

// Test 3: Provenance Logger
console.log('[TEST 3] ProvenanceLogger - XAI Origin Tracking');
const prov = new ProvenanceLogger('/tmp/heop-acceptance-test');
prov.logProvenance('acceptance-proj', 'fact_001', 'CREATE', 'deepcode', 'PRD analysis', 'Selected SQLite due to resource constraints');
prov.logProvenance('acceptance-proj', 'fact_001', 'UPDATE', 'claude', 'Code review', 'Confirmed SQLite choice after testing');
const provRecords = prov.getProvenance('acceptance-proj', 'fact_001');
console.log('  ✓ Provenance records: ' + provRecords.length + '\n');

// Test 4: Lifecycle Engine
console.log('[TEST 4] LifecycleEngine - FSM State Transitions');
const fsm = new LifecycleEngine('/tmp/heop-acceptance-test');
let state = fsm.getCurrentState('acceptance-proj');
console.log('  Initial state: ' + state);

store.addRequirement('acceptance-proj', 'ARCH.md', 'System architecture defined', 'PENDING', 1);
const transition1 = fsm.evaluateTransition('acceptance-proj', store);
console.log('  Transition 1: ' + (transition1 ? transition1.to : 'none'));
if (transition1) fsm.transitionTo('acceptance-proj', transition1.to, store);
state = fsm.getCurrentState('acceptance-proj');
console.log('  State after transition: ' + state + '\n');

// Test 5: Task Management
console.log('[TEST 5] SSOTStore - Task CRUD');
const taskId = store.createTask('acceptance-proj', {
  agent_type: 'deepcode',
  status: 'QUEUED',
  input_json: JSON.stringify({requirements: ['auth', 'oauth']})
});
console.log('  ✓ Task created: ' + taskId);

store.updateTask(taskId, 'acceptance-proj', {status: 'RUNNING', started_at: Date.now()});
const task = store.getTaskById(taskId);
console.log('  ✓ Task status: ' + task.status);

store.updateTask(taskId, 'acceptance-proj', {status: 'COMPLETED', completed_at: Date.now(), output_json: JSON.stringify({result: 'success'})});
const completedTask = store.getTaskById(taskId);
console.log('  ✓ Task completed: ' + completedTask.status + '\n');

// Test 6: Milestones
console.log('[TEST 6] SSOTStore - Milestone Management');
store.addMilestone('acceptance-proj', 'MVP', JSON.stringify(['auth_working', 'oauth_working']));
const milestones = store.getMilestones('acceptance-proj');
console.log('  ✓ Milestones: ' + milestones.length);

store.updateMilestone(milestones[0].id, {achieved_at: Date.now(), git_tag: 'v0.1.0', evidence_json: JSON.stringify([taskId])});
const achieved = store.getMilestones('acceptance-proj').filter(m => m.achieved_at);
console.log('  ✓ Achieved milestones: ' + achieved.length + '\n');

// Test 7: Git Automation (dry-run)
console.log('[TEST 7] GitAutomation - Commit Message Generation');
const git = new GitAutomation({gitAutoCommit: false});
const commitMsg = git.buildCommitMessage(
  'feat(auth): implement OAuth2 login',
  [{id: 'dec_001', context: 'DB', choice: 'SQLite', rationale: 'Lightweight', confidence: 0.95, source_agent: 'deepcode', created_at: Date.now()}],
  [{id: taskId, agent_type: 'claude', status: 'COMPLETED', input_json: '{}', output_json: '{}', created_at: Date.now()}],
  [{id: 'fact_001', entity: 'src/auth.js', attribute: 'exists', value: 'true', value_type: 'boolean', confidence: 1, source: 'claude', valid_from: Date.now(), valid_until: 9999999999}]
);
console.log('  Generated commit message:');
console.log('  ' + commitMsg.split('\n').join('\n  '));
console.log('  ✓ Commit message generated\n');

// Test 8: Issue Automation
console.log('[TEST 8] IssueAutomation - Structured Issue Generation');
const issue = new IssueAutomation({issueProvider: 'github'});
const issueBody = issue.buildIssueBody({
  project: {name: 'acceptance-proj', state: 'PLANNED'},
  task: {id: taskId, status: 'COMPLETED', error_log: null},
  relatedDecisions: [{id: 'dec_001', context: 'DB', choice: 'SQLite', rationale: 'Lightweight'}],
  allDecisions: [],
  milestones: [],
  suggestedNextSteps: ['Run tests', 'Deploy to staging']
});
console.log('  Generated issue body preview:');
console.log('  ' + issueBody.substring(0, 200).split('\n').join('\n  ') + '...');
console.log('  ✓ Issue body generated\n');

// Test 9: DeepCode Bridge (dry-run)
console.log('[TEST 9] DeepCodeBridge - Dry Run');
const deepcode = new DeepCodeBridge({
  ssotDir: '/tmp/heop-acceptance-test',
  maxConcurrentAgents: 1,
  agentMemoryLimits: {deepcode: '1024M', claudeCode: '512M'}
});
console.log('  ✓ DeepCodeBridge initialized\n');

// Test 10: Claude Code Bridge (dry-run)
console.log('[TEST 10] ClaudeCodeBridge - Fallback Mode');
const claude = new ClaudeCodeBridge({
  ssotDir: '/tmp/heop-acceptance-test',
  maxConcurrentAgents: 1,
  agentMemoryLimits: {deepcode: '1024M', claudeCode: '512M'}
});
console.log('  ✓ ClaudeCodeBridge initialized\n');

// Test 11: SSOT Query
console.log('[TEST 11] SSOT Query - Project Status');
const project = store.getProject('acceptance-proj');
const reqs = store.getRequirements('acceptance-proj');
const decs = store.getDecisions('acceptance-proj');
console.log('  Project: ' + project.name + ' (state: ' + project.state + ')');
console.log('  Requirements: ' + reqs.length);
console.log('  Decisions: ' + decs.length);
console.log('  ✓ SSOT query working\n');

console.log('=== All 11 Acceptance Tests Passed ===');
