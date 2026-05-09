export default {
  plugins: [
    {
      name: 'engineering-os',
      entry: './plugins/engineering-os/dist/index.js',
      config: {
        // SSOT data directory (project databases stored here)
        ssotDir: '~/.hermes/ssot-data',
        
        // Git automation settings
        gitAutoCommit: true,
        
        // Issue provider: 'github' or 'gitlab'
        issueProvider: 'github',
        
        // Resource safety for 2-core 4G machines
        maxConcurrentAgents: 1,  // Force serial execution
        
        // Sub-agent memory limits
        agentMemoryLimits: {
          deepcode: '1024M',   // Cold start phase
          claudeCode: '512M'   // Incremental development phase
        }
      }
    }
  ]
};
