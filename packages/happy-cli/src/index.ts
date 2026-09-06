#!/usr/bin/env node

/**
 * CLI entry point for happy command
 * 
 * Simple argument parsing without any CLI framework dependencies
 */


import chalk from 'chalk'
import { isDebug } from '@/utils/env'
import { runClaude, StartOptions } from '@/claude/runClaude'
import { logger } from './ui/logger'
import { readCredentials, readSettings } from './persistence'
import { authAndSetupMachineIfNeeded } from './ui/auth'
import packageJson from '../package.json'
import { z } from 'zod'
import { startDaemon } from './daemon/run'
import { isDaemonRunningCurrentlyInstalledHappyVersion, startDaemonDetached, startDaemonDetachedAndAwaitReady, stopDaemon } from './daemon/controlClient'
import { getLatestDaemonLog } from './ui/logger'
import { killRunawayHappyProcesses } from './daemon/doctor'
import { install } from './daemon/install'
import { uninstall } from './daemon/uninstall'
import { ApiClient } from './api/api'
import { runDoctorCommand } from './ui/doctor'
import { listDaemonSessions, stopDaemonSession } from './daemon/controlClient'
import { handleAuthCommand } from './commands/auth'
import { handleConnectCommand } from './commands/connect'
import { handleUpdateCommand } from './commands/update'
import { claudeCliPath } from './claude/claudeLocal'
import { execFileSync } from 'node:child_process'
import { PUBLIC_DAEMON_SUBCOMMANDS, resolveCliInvocation, suggestClosestCommand } from './cli/commandRouting'
import { CODEX_CLI_HELP, CodexCliSelectionCancelledError, CodexCliUsageError, parseCodexCliInvocation, resolveCodexResumeFile } from './codex/cli'

// Give the process a distinctive title so it does not show up as a generic
// `node ... dist/index.mjs ...` in `ps`/`pkill`. Otherwise tooling and AI agents that
// run `pkill -f index.mjs` to kill some unrelated `index.mjs` service also kill Happy
// (notably the long-lived daemon) by accident. On Linux, assigning `process.title`
// overwrites the argv shown in `/proc/<pid>/cmdline`, so `index.mjs` no longer appears.
// We keep the `happy-next-cli` token (matched by daemon process discovery in
// `daemon/doctor.ts`, and as the truncated `comm` matched by `name.includes('happy')`)
// and the original args (used to classify daemon / session / version-check processes).
process.title = ['happy-next-cli', ...process.argv.slice(2)].join(' ');

(async () => {
  const rawArgs = process.argv.slice(2)
  const invocation = resolveCliInvocation(rawArgs)

  if (invocation.kind === 'unknown-command') {
    console.error(chalk.red(`Error: unknown command "${invocation.command}"`))
    if (invocation.suggestion) {
      console.error(`\nDid you mean?\n  ${chalk.cyan(['happy', invocation.suggestion, ...rawArgs.slice(1)].join(' '))}`)
    }
    console.error(`\nTo pass these arguments to Claude, use:\n  ${chalk.cyan(['happy', 'claude', ...rawArgs].join(' '))}`)
    process.exit(2)
  }

  const args = invocation.kind === 'claude' ? invocation.args : rawArgs

  // If --version is passed - do not log, its likely daemon inquiring about our version
  if (!args.includes('--version')) {
    logger.debug('Starting happy CLI with args: ', process.argv)
  }

  // Check if first argument is a subcommand
  const subcommand = invocation.kind === 'happy-command' ? invocation.command : undefined
  
  // Log which subcommand was detected (for debugging)
  if (!args.includes('--version')) {
  }

  if (subcommand === 'orchestrator-oneshot') {
    try {
      const { runOrchestratorOneShot } = await import('@/orchestrator/runOneShot');
      const exitCode = await runOrchestratorOneShot(args.slice(1));
      process.exit(exitCode);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error');
      if (isDebug()) {
        console.error(error);
      }
      process.exit(1);
    }
    return;
  } else if (subcommand === 'doctor') {
    // Check for clean subcommand
    if (args[1] === 'clean') {
      const result = await killRunawayHappyProcesses()
      console.log(`Cleaned up ${result.killed} runaway processes`)
      if (result.errors.length > 0) {
        console.log('Errors:', result.errors)
      }
      process.exit(0)
    }
    await runDoctorCommand();
    return;
  } else if (subcommand === 'auth') {
    // Handle auth subcommands
    try {
      await handleAuthCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'connect') {
    // Handle connect subcommands
    try {
      await handleConnectCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'codex') {
    // Handle codex command
    try {
      const { runCodex } = await import('@/codex/runCodex');

      const codexInvocation = parseCodexCliInvocation(args.slice(1));
      if (codexInvocation.kind === 'help') {
        console.log(CODEX_CLI_HELP);
        return;
      }

      const resumeFile = codexInvocation.kind === 'resume'
        ? await resolveCodexResumeFile(codexInvocation)
        : undefined;
      
      const {
        credentials
      } = await authAndSetupMachineIfNeeded();

      // Auto-start daemon for codex (same as claude/gemini)
      logger.debug('Ensuring Happy background service is running & matches our version...');
      if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
        logger.debug('Starting Happy background service...');
        startDaemonDetached();
        // Give daemon a moment to write PID & port file
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      await runCodex({ credentials, startedBy: codexInvocation.startedBy, resumeFile });
      // Do not force exit here; allow instrumentation to show lingering handles
    } catch (error) {
      if (error instanceof CodexCliSelectionCancelledError) {
        return;
      }
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (error instanceof CodexCliUsageError) {
        console.error(`Run ${chalk.cyan('happy codex --help')} for usage.`)
      }
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'gemini') {
    // Handle gemini subcommands
    const geminiSubcommand = args[1];
    
    // Handle "happy gemini model set <model>" command
    if (geminiSubcommand === 'model' && args[2] === 'set' && args[3]) {
      const modelName = args[3];
      const validModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
      
      if (!validModels.includes(modelName)) {
        console.error(`Invalid model: ${modelName}`);
        console.error(`Available models: ${validModels.join(', ')}`);
        process.exit(1);
      }
      
      try {
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
        const { join } = require('path');
        const { homedir } = require('os');
        
        const configDir = join(homedir(), '.gemini');
        const configPath = join(configDir, 'config.json');
        
        // Create directory if it doesn't exist
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }
        
        // Read existing config or create new one
        let config: any = {};
        if (existsSync(configPath)) {
          try {
            config = JSON.parse(readFileSync(configPath, 'utf-8'));
          } catch (error) {
            // Ignore parse errors, start fresh
            config = {};
          }
        }
        
        // Update model in config
        config.model = modelName;
        
        // Write config back
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`✓ Model set to: ${modelName}`);
        console.log(`  Config saved to: ${configPath}`);
        console.log(`  This model will be used in future sessions.`);
        process.exit(0);
      } catch (error) {
        console.error('Failed to save model configuration:', error);
        process.exit(1);
      }
    }
    
    // Handle "happy gemini model get" command
    if (geminiSubcommand === 'model' && args[2] === 'get') {
      try {
        const { existsSync, readFileSync } = require('fs');
        const { join } = require('path');
        const { homedir } = require('os');
        
        const configPaths = [
          join(homedir(), '.gemini', 'config.json'),
          join(homedir(), '.config', 'gemini', 'config.json'),
        ];
        
        let model: string | null = null;
        for (const configPath of configPaths) {
          if (existsSync(configPath)) {
            try {
              const config = JSON.parse(readFileSync(configPath, 'utf-8'));
              model = config.model || config.GEMINI_MODEL || null;
              if (model) break;
            } catch (error) {
              // Ignore parse errors
            }
          }
        }
        
        if (model) {
          console.log(`Current model: ${model}`);
        } else if (process.env.GEMINI_MODEL) {
          console.log(`Current model: ${process.env.GEMINI_MODEL} (from GEMINI_MODEL env var)`);
        } else {
          console.log('Current model: gemini-2.5-pro (default)');
        }
        process.exit(0);
      } catch (error) {
        console.error('Failed to read model configuration:', error);
        process.exit(1);
      }
    }
    
    // Handle "happy gemini project set <project-id>" command
    if (geminiSubcommand === 'project' && args[2] === 'set' && args[3]) {
      const projectId = args[3];
      
      try {
        const { saveGoogleCloudProjectToConfig } = await import('@/gemini/utils/config');
        const { readCredentials } = await import('@/persistence');
        const { ApiClient } = await import('@/api/api');
        
        // Try to get current user email from Happy cloud token
        let userEmail: string | undefined = undefined;
        try {
          const credentials = await readCredentials();
          if (credentials) {
            const api = await ApiClient.create(credentials);
            const vendorToken = await api.getVendorToken('gemini');
            if (vendorToken?.oauth?.id_token) {
              const parts = vendorToken.oauth.id_token.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                userEmail = payload.email;
              }
            }
          }
        } catch {
          // If we can't get email, project will be saved globally
        }
        
        saveGoogleCloudProjectToConfig(projectId, userEmail);
        console.log(`✓ Google Cloud Project set to: ${projectId}`);
        if (userEmail) {
          console.log(`  Linked to account: ${userEmail}`);
        }
        console.log(`  This project will be used for Google Workspace accounts.`);
        process.exit(0);
      } catch (error) {
        console.error('Failed to save project configuration:', error);
        process.exit(1);
      }
    }
    
    // Handle "happy gemini project get" command
    if (geminiSubcommand === 'project' && args[2] === 'get') {
      try {
        const { readGeminiLocalConfig } = await import('@/gemini/utils/config');
        const config = readGeminiLocalConfig();
        
        if (config.googleCloudProject) {
          console.log(`Current Google Cloud Project: ${config.googleCloudProject}`);
          if (config.googleCloudProjectEmail) {
            console.log(`  Linked to account: ${config.googleCloudProjectEmail}`);
          } else {
            console.log(`  Applies to: all accounts (global)`);
          }
        } else if (process.env.GOOGLE_CLOUD_PROJECT) {
          console.log(`Current Google Cloud Project: ${process.env.GOOGLE_CLOUD_PROJECT} (from env var)`);
        } else {
          console.log('No Google Cloud Project configured.');
          console.log('');
          console.log('If you see "Authentication required" error, you may need to set a project:');
          console.log('  happy gemini project set <your-project-id>');
          console.log('');
          console.log('This is required for Google Workspace accounts.');
          console.log('Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca');
        }
        process.exit(0);
      } catch (error) {
        console.error('Failed to read project configuration:', error);
        process.exit(1);
      }
    }
    
    // Handle "happy gemini project" (no subcommand) - show help
    if (geminiSubcommand === 'project' && !args[2]) {
      console.log('Usage: happy gemini project <command>');
      console.log('');
      console.log('Commands:');
      console.log('  set <project-id>   Set Google Cloud Project ID');
      console.log('  get                Show current Google Cloud Project ID');
      console.log('');
      console.log('Google Workspace accounts require a Google Cloud Project.');
      console.log('If you see "Authentication required" error, set your project ID.');
      console.log('');
      console.log('Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca');
      process.exit(0);
    }
    
    // Handle gemini command (ACP-based agent)
    try {
      const { runGemini } = await import('@/gemini/runGemini');
      
      // Parse startedBy argument
      let startedBy: 'daemon' | 'terminal' | undefined = undefined;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--started-by') {
          startedBy = args[++i] as 'daemon' | 'terminal';
        }
      }
      
      const {
        credentials
      } = await authAndSetupMachineIfNeeded();

      // Auto-start daemon for gemini (same as claude)
      logger.debug('Ensuring Happy background service is running & matches our version...');
      if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
        logger.debug('Starting Happy background service...');
        startDaemonDetached();
        // Give daemon a moment to write PID & port file
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      await runGemini({credentials, startedBy});
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'update') {
    try {
      await handleUpdateCommand();
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'logout') {
    // Keep for backward compatibility - redirect to auth logout
    console.log(chalk.yellow('Note: "happy logout" is deprecated. Use "happy auth logout" instead.\n'));
    try {
      await handleAuthCommand(['logout']);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'notify') {
    // Handle notification command
    try {
      await handleNotifyCommand(args.slice(1));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
    return;
  } else if (subcommand === 'daemon') {
    // Show daemon management help
    const daemonSubcommand = args[1]

    if (daemonSubcommand === 'list') {
      try {
        const sessions = await listDaemonSessions()

        if (sessions.length === 0) {
          console.log('No active sessions this daemon is aware of (they might have been started by a previous version of the daemon)')
        } else {
          console.log('Active sessions:')
          console.log(JSON.stringify(sessions, null, 2))
        }
      } catch (error) {
        console.log('No daemon running')
      }
      return

    } else if (daemonSubcommand === 'stop-session') {
      const sessionId = args[2]
      if (!sessionId) {
        console.error('Session ID required')
        process.exit(1)
      }

      try {
        const success = await stopDaemonSession(sessionId)
        console.log(success ? 'Session stopped' : 'Failed to stop session')
      } catch (error) {
        console.log('No daemon running')
      }
      return

    } else if (daemonSubcommand === 'start') {
      const started = await startDaemonDetachedAndAwaitReady(packageJson.version);
      console.log(started ? 'Daemon started successfully' : 'Failed to start daemon');
      process.exit(started ? 0 : 1);
    } else if (daemonSubcommand === 'start-sync') {
      await startDaemon()
      process.exit(0)
    } else if (daemonSubcommand === 'stop') {
      await stopDaemon()
      process.exit(0)
    } else if (daemonSubcommand === 'restart') {
      await stopDaemon()
      const started = await startDaemonDetachedAndAwaitReady(packageJson.version);
      console.log(started ? 'Daemon restarted successfully' : 'Failed to restart daemon');
      process.exit(started ? 0 : 1)
    } else if (daemonSubcommand === 'status') {
      // Show daemon-specific doctor output
      await runDoctorCommand('daemon')
      process.exit(0)
    } else if (daemonSubcommand === 'logs') {
      // Simply print the path to the latest daemon log file
      const latest = await getLatestDaemonLog()
      if (!latest) {
        console.log('No daemon logs found')
      } else {
        console.log(latest.path)
      }
      process.exit(0)
    } else if (daemonSubcommand === 'enable' || daemonSubcommand === 'install') {
      try {
        await install()
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
        process.exit(1)
      }
      process.exit(0)
    } else if (daemonSubcommand === 'disable' || daemonSubcommand === 'uninstall') {
      try {
        await uninstall()
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
        process.exit(1)
      }
      process.exit(0)
    } else if (!daemonSubcommand || daemonSubcommand === 'help' || daemonSubcommand === '--help' || daemonSubcommand === '-h') {
      console.log(`
${chalk.bold('happy daemon')} - Daemon management

${chalk.bold('Usage:')}
  happy daemon start              Start the daemon (detached)
  happy daemon stop               Stop the daemon (sessions stay alive)
  happy daemon restart            Restart the daemon
  happy daemon status             Show daemon status
  happy daemon list               List active sessions
  happy daemon enable             Enable auto-start on boot
  happy daemon disable            Disable auto-start on boot

  If you want to kill all happy related processes run
  ${chalk.cyan('happy doctor clean')}

${chalk.bold('Note:')} The daemon runs in the background and manages Claude sessions.

${chalk.bold('To clean up runaway processes:')} Use ${chalk.cyan('happy doctor clean')}
`)
    } else {
      const suggestion = suggestClosestCommand(daemonSubcommand, PUBLIC_DAEMON_SUBCOMMANDS)
      console.error(chalk.red(`Error: unknown daemon command "${daemonSubcommand}"`))
      if (suggestion) {
        console.error(`\nDid you mean?\n  ${chalk.cyan(`happy daemon ${suggestion}`)}`)
      }
      process.exit(2)
    }
    return;
  } else {
    // Parse command line arguments for main command
    const options: StartOptions = {}
    let showHelp = false
    let showVersion = false
    let chromeOverride: boolean | undefined = undefined  // Track explicit --chrome or --no-chrome
    const unknownArgs: string[] = [] // Collect unknown args to pass through to claude
    const passthrough = invocation.kind === 'claude' && invocation.passthrough
    const argsToParse = passthrough ? [] : args

    if (passthrough) {
      options.claudeArgs = [...args]
    }

    for (let i = 0; i < argsToParse.length; i++) {
      const arg = argsToParse[i]

      if (arg === '-h' || arg === '--help') {
        showHelp = true
        // Also pass through to claude
        unknownArgs.push(arg)
      } else if (arg === '-v' || arg === '--version') {
        showVersion = true
        // Also pass through to claude (will show after our version)
        unknownArgs.push(arg)
      } else if (arg === '--happy-starting-mode') {
        options.startingMode = z.enum(['local', 'remote']).parse(argsToParse[++i])
      } else if (arg === '--yolo') {
        // Shortcut for --dangerously-skip-permissions
        unknownArgs.push('--dangerously-skip-permissions')
      } else if (arg === '--started-by') {
        options.startedBy = argsToParse[++i] as 'daemon' | 'terminal'
      } else if (arg === '--js-runtime') {
        const runtime = argsToParse[++i]
        if (runtime !== 'node' && runtime !== 'bun') {
          console.error(chalk.red(`Invalid --js-runtime value: ${runtime}. Must be 'node' or 'bun'`))
          process.exit(1)
        }
        options.jsRuntime = runtime
      } else if (arg === '--claude-env') {
        // Parse KEY=VALUE environment variable to pass to Claude
        const envArg = argsToParse[++i]
        if (envArg && envArg.includes('=')) {
          const eqIndex = envArg.indexOf('=')
          const key = envArg.substring(0, eqIndex)
          const value = envArg.substring(eqIndex + 1)
          options.claudeEnvVars = options.claudeEnvVars || {}
          options.claudeEnvVars[key] = value
        } else {
          console.error(chalk.red(`Invalid --claude-env format: ${envArg}. Expected KEY=VALUE`))
          process.exit(1)
        }
      } else if (arg === '--chrome') {
        chromeOverride = true
        // We'll add --chrome to claudeArgs after resolving settings default
      } else if (arg === '--no-chrome') {
        chromeOverride = false
        // Happy-specific flag to disable chrome even if default is on
      } else if (arg === '--settings') {
        // Intercept --settings flag - Happy uses this internally for session hooks
        const settingsValue = argsToParse[++i] // consume the value
        console.warn(chalk.yellow(`⚠️  Warning: --settings is used internally by Happy for session tracking.`))
        console.warn(chalk.yellow(`   Your settings file "${settingsValue}" will be ignored.`))
        console.warn(chalk.yellow(`   To configure Claude, edit ~/.claude/settings.json instead.`))
        // Don't pass through to claudeArgs
      } else {
        // Pass unknown arguments through to claude
        unknownArgs.push(arg)
        // Check if this arg expects a value (simplified check for common patterns)
        if (i + 1 < argsToParse.length && !argsToParse[i + 1].startsWith('-')) {
          unknownArgs.push(argsToParse[++i])
        }
      }
    }

    // Add unknown args to claudeArgs
    if (unknownArgs.length > 0) {
      options.claudeArgs = [...(options.claudeArgs || []), ...unknownArgs]
    }

    // Resolve Chrome mode: explicit flag > settings > false
    const settings = await readSettings()
    const chromeEnabled = chromeOverride ?? settings.chromeMode ?? false
    if (chromeEnabled) {
      options.claudeArgs = [...(options.claudeArgs || []), '--chrome']
    }

    // Show help
    if (showHelp) {
      console.log(`
${chalk.bold('happy')} - Claude Code On the Go

${chalk.bold('Usage:')}
  happy [options]         Start Claude with mobile control
  happy claude [args]     Start Claude with explicit positional arguments
  happy -- <args>         Pass positional arguments directly to Claude
  happy auth              Manage authentication
  happy codex             Start Codex mode
  happy codex resume      Resume the latest Codex session in this directory
  happy gemini            Start Gemini mode (ACP)
  happy connect           Connect AI vendor API keys
  happy notify            Send push notification
  happy daemon            Manage background service
  happy daemon enable     Auto-start daemon on boot
  happy doctor            System diagnostics & troubleshooting
  happy update            Upgrade happy to the latest version

${chalk.bold('Examples:')}
  happy                    Start session
  happy --yolo             Start with bypassing permissions
                            happy sugar for --dangerously-skip-permissions
  happy --chrome           Enable Chrome browser access for this session
  happy --no-chrome        Disable Chrome even if default is on
  happy --js-runtime bun   Use bun instead of node to spawn Claude Code
  happy --claude-env ANTHROPIC_BASE_URL=http://127.0.0.1:3456
                           Use a custom API endpoint (e.g., claude-code-router)
  happy auth login --force Authenticate
  happy doctor             Run diagnostics

${chalk.bold('Happy Next supports ALL Claude options!')}
  Use any claude flag with happy as you would with claude. Our favorite:

  happy --resume

${chalk.gray('─'.repeat(60))}
${chalk.bold.cyan('Claude Code Options (from `claude --help`):')}
`)
      
      // Run claude --help and display its output
      // Use execFileSync directly with claude CLI for runtime-agnostic compatibility
      try {
        const claudeHelp = execFileSync(claudeCliPath, ['--help'], { encoding: 'utf8' })
        console.log(claudeHelp)
      } catch (e) {
        console.log(chalk.yellow('Could not retrieve claude help. Make sure claude is installed.'))
      }
      
      process.exit(0)
    }

    // Show version
    if (showVersion) {
      const versions: { name: string; version: string }[] = [
        { name: 'Happy Next', version: packageJson.version },
      ]

      const checks = [
        { name: 'Claude', cmd: 'claude', args: ['--version'] },
        { name: 'Codex', cmd: 'codex', args: ['--version'] },
        { name: 'Gemini', cmd: 'gemini', args: ['--version'] },
      ]
      for (const { name, cmd, args: vArgs } of checks) {
        try {
          const ver = execFileSync(cmd, vArgs, { encoding: 'utf-8', timeout: 5000 }).trim()
          versions.push({ name, version: ver })
        } catch {
          // Not installed - skip
        }
      }

      const maxName = Math.max(...versions.map(v => v.name.length))
      for (const { name, version } of versions) {
        console.log(`${chalk.bold(name.padEnd(maxName))}  ${chalk.cyan(version)}`)
      }

      process.exit(0)
    }

    // Normal flow - auth and machine setup
    const {
      credentials
    } = await authAndSetupMachineIfNeeded();

    // Always auto-start daemon for simplicity
    logger.debug('Ensuring Happy background service is running & matches our version...');

    if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
      logger.debug('Starting Happy background service...');
      startDaemonDetached();
      // Give daemon a moment to write PID & port file
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Start the CLI
    try {
      await runClaude(credentials, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
      if (isDebug()) {
        console.error(error)
      }
      process.exit(1)
    }
  }
})();


/**
 * Handle notification command
 */
async function handleNotifyCommand(args: string[]): Promise<void> {
  let message = ''
  let title = ''
  let showHelp = false

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '-p' && i + 1 < args.length) {
      message = args[++i]
    } else if (arg === '-t' && i + 1 < args.length) {
      title = args[++i]
    } else if (arg === '-h' || arg === '--help') {
      showHelp = true
    } else {
      console.error(chalk.red(`Unknown argument for notify command: ${arg}`))
      process.exit(1)
    }
  }

  if (showHelp) {
    console.log(`
${chalk.bold('happy notify')} - Send notification

${chalk.bold('Usage:')}
  happy notify -p <message> [-t <title>]    Send notification with custom message and optional title
  happy notify -h, --help                   Show this help

${chalk.bold('Options:')}
  -p <message>    Notification message (required)
  -t <title>      Notification title (optional, defaults to "Happy Next")

${chalk.bold('Examples:')}
  happy notify -p "Deployment complete!"
  happy notify -p "System update complete" -t "Server Status"
  happy notify -t "Alert" -p "Database connection restored"
`)
    return
  }

  if (!message) {
    console.error(chalk.red('Error: Message is required. Use -p "your message" to specify the notification text.'))
    console.log(chalk.gray('Run "happy notify --help" for usage information.'))
    process.exit(1)
  }

  // Load credentials
  let credentials = await readCredentials()
  if (!credentials) {
    console.error(chalk.red('Error: Not authenticated. Please run "happy auth login" first.'))
    process.exit(1)
  }

  console.log(chalk.blue('📱 Sending push notification...'))

  try {
    // Create API client and send push notification
    const api = await ApiClient.create(credentials);

    // Use custom title or default to "Happy"
    const notificationTitle = title || 'Happy Next'

    // Send the push notification
    api.push().sendToAllDevices(
      notificationTitle,
      message,
      {
        source: 'cli',
        timestamp: Date.now()
      }
    )

    console.log(chalk.green('✓ Push notification sent successfully!'))
    console.log(chalk.gray(`  Title: ${notificationTitle}`))
    console.log(chalk.gray(`  Message: ${message}`))
    console.log(chalk.gray('  Check your mobile device for the notification.'))

    // Give a moment for the async operation to start
    await new Promise(resolve => setTimeout(resolve, 1000))

  } catch (error) {
    console.error(chalk.red('✗ Failed to send push notification'))
    throw error
  }
}
