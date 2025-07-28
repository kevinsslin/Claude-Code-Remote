#!/usr/bin/env node

/**
 * Claude-Code-Remote Unattended Remote Control Setup Assistant
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class RemoteControlSetup {
    constructor(sessionName = null) {
        this.sessionName = sessionName || 'claude-code-remote';
        this.claudeCodeRemoteHome = this.findClaudeCodeRemoteHome();
    }
    
    findClaudeCodeRemoteHome() {
        // If CLAUDE_CODE_REMOTE_HOME environment variable is set, use it
        if (process.env.CLAUDE_CODE_REMOTE_HOME) {
            return process.env.CLAUDE_CODE_REMOTE_HOME;
        }
        
        // If running from the Claude-Code-Remote directory, use current directory
        if (fs.existsSync(path.join(__dirname, 'package.json'))) {
            const packagePath = path.join(__dirname, 'package.json');
            try {
                const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                if (packageJson.name && packageJson.name.toLowerCase().includes('claude-code-remote')) {
                    return __dirname;
                }
            } catch (e) {
                // Continue searching
            }
        }
        
        // Search for Claude-Code-Remote in common locations
        const commonPaths = [
            path.join(process.env.HOME, 'dev', 'Claude-Code-Remote'),
            path.join(process.env.HOME, 'Projects', 'Claude-Code-Remote'),
            path.join(process.env.HOME, 'claude-code-remote'),
            __dirname // fallback to current script directory
        ];
        
        for (const searchPath of commonPaths) {
            if (fs.existsSync(searchPath) && fs.existsSync(path.join(searchPath, 'package.json'))) {
                try {
                    const packageJson = JSON.parse(fs.readFileSync(path.join(searchPath, 'package.json'), 'utf8'));
                    if (packageJson.name && packageJson.name.toLowerCase().includes('claude-code-remote')) {
                        return searchPath;
                    }
                } catch (e) {
                    // Continue searching
                }
            }
        }
        
        // If not found, use current directory as fallback
        return __dirname;
    }
    
    async setup() {
        console.log('🚀 Claude-Code-Remote Unattended Remote Control Setup\n');
        console.log('🎯 Goal: Remote access via mobile phone → Home computer Claude Code automatically executes commands\n');
        
        try {
            // 1. Check tmux
            await this.checkAndInstallTmux();
            
            // 2. Check Claude CLI
            await this.checkClaudeCLI();
            
            // 3. Setup Claude tmux session
            await this.setupClaudeSession();
            
            // 4. Session creation complete
            console.log('\n4️⃣ Session creation complete');
            
            // 5. Provide usage guide
            this.showUsageGuide();
            
        } catch (error) {
            console.error('❌ Error occurred during setup:', error.message);
        }
    }
    
    async checkAndInstallTmux() {
        console.log('1️⃣ Checking tmux installation status...');
        
        return new Promise((resolve) => {
            exec('which tmux', (error, stdout) => {
                if (error) {
                    console.log('❌ tmux not installed');
                    console.log('📦 Installing tmux...');
                    
                    exec('brew install tmux', (installError, installStdout, installStderr) => {
                        if (installError) {
                            console.log('❌ tmux installation failed, please install manually:');
                            console.log('   brew install tmux');
                            console.log('   or download from https://github.com/tmux/tmux');
                        } else {
                            console.log('✅ tmux installation successful');
                        }
                        resolve();
                    });
                } else {
                    console.log(`✅ tmux already installed: ${stdout.trim()}`);
                    resolve();
                }
            });
        });
    }
    
    async checkClaudeCLI() {
        console.log('\n2️⃣ Checking Claude CLI status...');
        
        return new Promise((resolve) => {
            exec('which claude', (error, stdout) => {
                if (error) {
                    console.log('❌ Claude CLI not found');
                    console.log('📦 Please install Claude CLI:');
                    console.log('   npm install -g @anthropic-ai/claude-code');
                } else {
                    console.log(`✅ Claude CLI installed: ${stdout.trim()}`);
                    
                    // Check version
                    exec('claude --version', (versionError, versionStdout) => {
                        if (!versionError) {
                            console.log(`📋 Version: ${versionStdout.trim()}`);
                        }
                    });
                }
                resolve();
            });
        });
    }
    
    async setupClaudeSession() {
        console.log('\n3️⃣ Setting up Claude tmux session...');
        
        return new Promise((resolve) => {
            // Check if session already exists
            exec(`tmux has-session -t ${this.sessionName} 2>/dev/null`, (checkError) => {
                if (!checkError) {
                    console.log('⚠️ Claude tmux session already exists');
                    console.log('🔄 Recreating session? (will kill existing session)');
                    
                    // For simplicity, recreate directly
                    this.killAndCreateSession(resolve);
                } else {
                    this.createNewSession(resolve);
                }
            });
        });
    }
    
    killAndCreateSession(resolve) {
        exec(`tmux kill-session -t ${this.sessionName} 2>/dev/null`, () => {
            setTimeout(() => {
                this.createNewSession(resolve);
            }, 1000);
        });
    }
    
    createNewSession(resolve) {
        // Use Claude-Code-Remote home directory as working directory
        const workingDir = this.claudeCodeRemoteHome;
        const command = `tmux new-session -d -s ${this.sessionName} -c "${workingDir}" clauderun`;
        
        console.log(`🚀 Creating Claude tmux session: ${this.sessionName}`);
        console.log(`📁 Working directory: ${workingDir}`);
        console.log(`💡 Using convenience command: clauderun (equivalent to claude --dangerously-skip-permissions)`);
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`❌ Session creation failed: ${error.message}`);
                if (stderr) {
                    console.log(`Error details: ${stderr}`);
                }
                // If clauderun fails, try using full path command
                console.log('🔄 Trying full path command...');
                const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
                const fallbackCommand = `tmux new-session -d -s ${this.sessionName} -c "${workingDir}" ${claudePath} --dangerously-skip-permissions`;
                exec(fallbackCommand, (fallbackError) => {
                    if (fallbackError) {
                        console.log(`❌ Full path command also failed: ${fallbackError.message}`);
                    } else {
                        console.log('✅ Claude tmux session created successfully (using full path)');
                        console.log(`📺 View session: tmux attach -t ${this.sessionName}`);
                        console.log(`🔚 Exit session: Ctrl+B, D (won't close Claude)`);
                    }
                    resolve();
                });
            } else {
                console.log('✅ Claude tmux session created successfully');
                console.log(`📺 View session: tmux attach -t ${this.sessionName}`);
                console.log(`🔚 Exit session: Ctrl+B, D (won't close Claude)`);
                resolve();
            }
        });
    }
    
    async testRemoteInjection() {
        console.log('\n💡 Session is ready, you can start using it');
        console.log('📋 Claude Code is waiting for your instructions');
        console.log('🔧 To test injection functionality, please use separate test script');
        return Promise.resolve();
    }
    
    showUsageGuide() {
        console.log('\n🎉 Setup complete! Unattended remote control is ready\n');
        
        console.log('🎯 New feature: clauderun convenience command');
        console.log('   You can now use clauderun instead of claude --dangerously-skip-permissions');
        console.log('   Clearer Claude Code startup method\n');
        
        console.log('📋 Usage workflow:');
        console.log('1. 🏠 Start email monitoring at home: npm run relay:pty');
        console.log('2. 🚪 When going out, Claude continues running in tmux');
        console.log('3. 📱 Receive Claude-Code-Remote email notifications on mobile');
        console.log('4. 💬 Reply to email with commands on mobile');
        console.log('5. 🤖 Claude at home automatically receives and executes commands');
        console.log('6. 🔄 Repeat above process, completely unattended\n');
        
        console.log('🔧 Management commands:');
        console.log(`   View Claude session: tmux attach -t ${this.sessionName}`);
        console.log(`   Exit session (without closing): Ctrl+B, D`);
        console.log(`   Kill session: tmux kill-session -t ${this.sessionName}`);
        console.log(`   View all sessions: tmux list-sessions\n`);
        
        console.log('🎛️ Multi-session support:');
        console.log('   Create custom session: node claude-control.js --session my-project');
        console.log('   Create multiple sessions: node claude-control.js --session frontend');
        console.log('                    node claude-control.js --session backend');
        console.log('   Email replies will automatically route to corresponding session\n');
        
        console.log('📱 Email testing:');
        console.log('   Token will include session information, automatically routing to correct tmux session');
        console.log(`   Recipient email: ${process.env.EMAIL_TO}`);
        console.log('   Reply with command: echo "Remote control test"\n');
        
        console.log('🚨 Important reminders:');
        console.log('- Claude session runs continuously in tmux, won\'t be interrupted by network disconnection/reconnection');
        console.log('- Email monitoring service needs to remain running');
        console.log('- Home computer needs to stay powered on with network connection');
        console.log('- Mobile can send email commands from anywhere');
        console.log('- Supports running multiple Claude sessions for different projects simultaneously\n');
        
        console.log('✅ Now you can achieve true unattended remote control! 🎯');
    }
    
    // Quick session restart method
    async quickRestart() {
        console.log('🔄 Quick restart Claude session...');
        
        return new Promise((resolve) => {
            this.killAndCreateSession(() => {
                console.log('✅ Claude session restarted');
                resolve();
            });
        });
    }
}

// Command line parameter processing
if (require.main === module) {
    const args = process.argv.slice(2);
    
    // Parse session name parameter
    let sessionName = null;
    const sessionIndex = args.indexOf('--session');
    if (sessionIndex !== -1 && args[sessionIndex + 1]) {
        sessionName = args[sessionIndex + 1];
    }
    
    const setup = new RemoteControlSetup(sessionName);
    
    if (sessionName) {
        console.log(`🎛️ Using custom session name: ${sessionName}`);
    }
    
    if (args.includes('--restart')) {
        setup.quickRestart();
    } else {
        setup.setup();
    }
}

module.exports = RemoteControlSetup;