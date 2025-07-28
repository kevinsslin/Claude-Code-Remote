/**
 * Email Notification Channel
 * Sends notifications via email with reply support
 */

const NotificationChannel = require('../base/channel');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const TmuxMonitor = require('../../utils/tmux-monitor');
const { execSync } = require('child_process');

class EmailChannel extends NotificationChannel {
    constructor(config = {}) {
        super('email', config);
        this.transporter = null;
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.templatesDir = path.join(__dirname, '../../assets/email-templates');
        this.tmuxMonitor = new TmuxMonitor();
        
        this._ensureDirectories();
        this._initializeTransporter();
    }

    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
        if (!fs.existsSync(this.templatesDir)) {
            fs.mkdirSync(this.templatesDir, { recursive: true });
        }
    }

    _generateToken() {
        // Generate short Token (uppercase letters + numbers, 8 digits)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let token = '';
        for (let i = 0; i < 8; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    _formatClaudeResponse(response) {
        if (!response || typeof response !== 'string') {
            return response;
        }

        // Split response into paragraphs for better formatting
        let formatted = response
            // Handle code blocks (```language or ```)
            .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                const language = lang || 'text';
                return `<div style="background-color: #1a1a1a; border: 1px solid #525252; border-radius: 4px; padding: 12px; margin: 10px 0; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 13px; overflow-x: auto;">
                    <div style="color: #888; font-size: 11px; margin-bottom: 6px; text-transform: uppercase;">${language}</div>
                    <pre style="margin: 0; color: #e0e0e0; white-space: pre-wrap;">${code.trim()}</pre>
                </div>`;
            })
            // Handle inline code (`code`)
            .replace(/`([^`]+)`/g, '<code style="background-color: #404040; color: #fbbf24; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 13px;">$1</code>')
            // Handle bullet points
            .replace(/^[\s]*[-*]\s+(.+)$/gm, '<div style="margin: 4px 0; padding-left: 20px; position: relative;"><span style="position: absolute; left: 0; color: #fbbf24;">•</span>$1</div>')
            // Handle numbered lists
            .replace(/^[\s]*(\d+)\.\s+(.+)$/gm, '<div style="margin: 4px 0; padding-left: 25px; position: relative;"><span style="position: absolute; left: 0; color: #60a5fa; font-weight: 600;">$1.</span>$2</div>')
            // Handle headers (## Header)
            .replace(/^##\s+(.+)$/gm, '<h4 style="color: #4ade80; font-size: 16px; font-weight: 600; margin: 15px 0 8px 0; border-bottom: 1px solid #525252; padding-bottom: 4px;">$1</h4>')
            // Handle bold text
            .replace(/\*\*([^*]+)\*\*/g, '<strong style="color: #ffffff; font-weight: 600;">$1</strong>')
            // Handle italic text
            .replace(/\*([^*]+)\*/g, '<em style="color: #d1d1d1; font-style: italic;">$1</em>')
            // Handle line breaks - convert double newlines to paragraph breaks
            .replace(/\n\n/g, '</p><p style="margin: 12px 0; line-height: 1.6;">')
            // Handle single newlines
            .replace(/\n/g, '<br>');

        // Wrap in paragraph tags if not already formatted
        if (!formatted.includes('<p') && !formatted.includes('<div') && !formatted.includes('<h')) {
            formatted = `<p style="margin: 12px 0; line-height: 1.6;">${formatted}</p>`;
        } else if (formatted.includes('</p><p')) {
            formatted = `<p style="margin: 12px 0; line-height: 1.6;">${formatted}</p>`;
        }

        return formatted;
    }

    _initializeTransporter() {
        if (!this.config.smtp) {
            this.logger.warn('SMTP configuration not found');
            return;
        }

        try {
            this.transporter = nodemailer.createTransport({
                host: this.config.smtp.host,
                port: this.config.smtp.port,
                secure: this.config.smtp.secure || false,
                auth: {
                    user: this.config.smtp.auth.user,
                    pass: this.config.smtp.auth.pass
                },
                // Add timeout settings
                connectionTimeout: parseInt(process.env.SMTP_TIMEOUT) || 10000,
                greetingTimeout: parseInt(process.env.SMTP_TIMEOUT) || 10000,
                socketTimeout: parseInt(process.env.SMTP_TIMEOUT) || 10000
            });

            this.logger.debug('Email transporter initialized');
        } catch (error) {
            this.logger.error('Failed to initialize email transporter:', error.message);
        }
    }

    _getCurrentTmuxSession() {
        try {
            // Try to get current tmux session
            const tmuxSession = execSync('tmux display-message -p "#S"', { 
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            
            return tmuxSession || null;
        } catch (error) {
            // Not in a tmux session or tmux not available
            return null;
        }
    }

    async _sendImpl(notification) {
        if (!this.transporter) {
            throw new Error('Email transporter not initialized');
        }

        if (!this.config.to) {
            throw new Error('Email recipient not configured');
        }

        // Generate session ID and Token
        const sessionId = uuidv4();
        const token = this._generateToken();
        
        // Get current tmux session and conversation content
        const tmuxSession = this._getCurrentTmuxSession();
        if (tmuxSession && !notification.metadata) {
            const conversation = this.tmuxMonitor.getRecentConversation(tmuxSession);
            notification.metadata = {
                userQuestion: conversation.userQuestion || notification.message,
                claudeResponse: conversation.claudeResponse || notification.message,
                tmuxSession: tmuxSession
            };
        }
        
        // Create session record
        await this._createSession(sessionId, notification, token);

        // Generate email content
        const emailContent = this._generateEmailContent(notification, sessionId, token);
        
        const mailOptions = {
            from: this.config.from || this.config.smtp.auth.user,
            to: this.config.to,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
            // Add custom headers for reply recognition
            headers: {
                'X-Claude-Code-Remote-Session-ID': sessionId,
                'X-Claude-Code-Remote-Type': notification.type
            }
        };

        try {
            const result = await this.transporter.sendMail(mailOptions);
            this.logger.info(`Email sent successfully to ${this.config.to}, Session: ${sessionId}`);
            return true;
        } catch (error) {
            this.logger.error('Failed to send email:', error.message);
            // Clean up failed session
            await this._removeSession(sessionId);
            return false;
        }
    }

    async _createSession(sessionId, notification, token) {
        const session = {
            id: sessionId,
            token: token,
            type: 'pty',
            created: new Date().toISOString(),
            expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Expires after 24 hours
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
            cwd: process.cwd(),
            notification: {
                type: notification.type,
                project: notification.project,
                message: notification.message
            },
            status: 'waiting',
            commandCount: 0,
            maxCommands: 10
        };

        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
        
        // Also save in PTY mapping format
        const sessionMapPath = process.env.SESSION_MAP_PATH || path.join(__dirname, '../../data/session-map.json');
        let sessionMap = {};
        if (fs.existsSync(sessionMapPath)) {
            try {
                sessionMap = JSON.parse(fs.readFileSync(sessionMapPath, 'utf8'));
            } catch (e) {
                sessionMap = {};
            }
        }
        
        // Use passed tmux session name or detect current session
        let tmuxSession = notification.metadata?.tmuxSession || this._getCurrentTmuxSession() || 'claude-code-remote';
        
        sessionMap[token] = {
            type: 'pty',
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000),
            cwd: process.cwd(),
            sessionId: sessionId,
            tmuxSession: tmuxSession,
            description: `${notification.type} - ${notification.project}`
        };
        
        // Ensure directory exists
        const mapDir = path.dirname(sessionMapPath);
        if (!fs.existsSync(mapDir)) {
            fs.mkdirSync(mapDir, { recursive: true });
        }
        
        fs.writeFileSync(sessionMapPath, JSON.stringify(sessionMap, null, 2));
        
        this.logger.debug(`Session created: ${sessionId}, Token: ${token}`);
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    _generateEmailContent(notification, sessionId, token) {
        const template = this._getTemplate(notification.type);
        const timestamp = new Date().toLocaleString('zh-CN');
        
        // Get project directory name (last level directory)
        const projectDir = path.basename(process.cwd());
        
        // Extract user question (from notification.metadata if available)
        let userQuestion = '';
        let claudeResponse = '';
        
        if (notification.metadata) {
            userQuestion = notification.metadata.userQuestion || '';
            claudeResponse = notification.metadata.claudeResponse || '';
        }
        
        // Limit user question length for title
        const maxQuestionLength = 30;
        const shortQuestion = userQuestion.length > maxQuestionLength ? 
            userQuestion.substring(0, maxQuestionLength) + '...' : userQuestion;
        
        // Generate more distinctive title
        let enhancedSubject = template.subject;
        if (shortQuestion) {
            enhancedSubject = enhancedSubject.replace('{{project}}', `${projectDir} | ${shortQuestion}`);
        } else {
            enhancedSubject = enhancedSubject.replace('{{project}}', projectDir);
        }
        
        // Template variable replacement
        const variables = {
            project: projectDir,
            message: notification.message,
            timestamp: timestamp,
            sessionId: sessionId,
            token: token,
            type: notification.type === 'completed' ? 'Task completed' : 'Waiting for input',
            userQuestion: userQuestion || 'No specified task',
            claudeResponse: this._formatClaudeResponse(claudeResponse || notification.message),
            projectDir: projectDir,
            shortQuestion: shortQuestion || 'No specific question'
        };

        let subject = enhancedSubject;
        let html = template.html;
        let text = template.text;

        // Replace template variables
        Object.keys(variables).forEach(key => {
            const placeholder = new RegExp(`{{${key}}}`, 'g');
            subject = subject.replace(placeholder, variables[key]);
            html = html.replace(placeholder, variables[key]);
            text = text.replace(placeholder, variables[key]);
        });

        return { subject, html, text };
    }

    _getTemplate(type) {
        // Default templates
        const templates = {
            completed: {
                subject: '[Claude-Code-Remote #{{token}}] Claude Code Task Completed - {{project}}',
                html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Claude Code Task Completed</title>
                    <style>
                        @media only screen and (max-width: 600px) {
                            .container { width: 100% !important; padding: 10px !important; }
                            .content { padding: 15px !important; }
                            h2 { font-size: 18px !important; }
                            h3 { font-size: 16px !important; }
                            h4 { font-size: 14px !important; }
                        }
                    </style>
                </head>
                <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #e0e0e0; background-color: #1a1a1a;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 20px;">
                                <table class="container" role="presentation" style="max-width: 600px; width: 100%; margin: 0 auto; background-color: #2d2d2d; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid #404040;">
                                    <!-- Header -->
                                    <tr>
                                        <td class="content" style="padding: 40px 30px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-align: center;">
                                            <h1 style="margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">🎉 Task Completed</h1>
                                            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.8;">Claude Code has finished your request</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Project Info -->
                                    <tr>
                                        <td class="content" style="padding: 30px;">
                                            <table role="presentation" style="width: 100%; background-color: #4a4a4a; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid #666666;">
                                                <tr>
                                                    <td style="padding: 10px 0; font-size: 15px; font-weight: 500;">
                                                        <span style="color: #f0f0f0; display: inline-block; width: 80px;">📁 Project:</span>
                                                        <span style="color: #10b981; font-weight: 600;">{{projectDir}}</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 10px 0; font-size: 15px; font-weight: 500; border-top: 1px solid #666666;">
                                                        <span style="color: #f0f0f0; display: inline-block; width: 80px;">⏰ Time:</span>
                                                        <span style="color: #d0d0d0;">{{timestamp}}</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 10px 0; font-size: 15px; font-weight: 500; border-top: 1px solid #666666;">
                                                        <span style="color: #f0f0f0; display: inline-block; width: 80px;">✅ Status:</span>
                                                        <span style="color: #10b981; font-weight: 600;">{{type}}</span>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>

                                    <!-- Your Question -->
                                    <tr>
                                        <td class="content" style="padding: 0 30px 25px;">
                                            <div style="background-color: #404040; border-radius: 8px; border-left: 4px solid #60a5fa; padding: 20px; margin-bottom: 20px;">
                                                <h3 style="margin: 0 0 15px 0; color: #60a5fa; font-size: 16px; font-weight: 600;">📝 Your Question</h3>
                                                <div style="background-color: #2d2d2d; padding: 15px; border-radius: 6px; font-style: italic; color: #e0e0e0; line-height: 1.6; word-wrap: break-word;">
                                                    {{userQuestion}}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>

                                    <!-- Claude's Response -->
                                    <tr>
                                        <td class="content" style="padding: 0 30px 25px;">
                                            <div style="background-color: #404040; border-radius: 8px; border-left: 4px solid #10b981; padding: 20px; margin-bottom: 20px;">
                                                <h3 style="margin: 0 0 15px 0; color: #10b981; font-size: 16px; font-weight: 600;">🤖 Claude's Response</h3>
                                                <div style="background-color: #2d2d2d; padding: 15px; border-radius: 6px; color: #e0e0e0; line-height: 1.6; word-wrap: break-word;">
                                                    {{claudeResponse}}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>

                                    <!-- How to Continue -->
                                    <tr>
                                        <td class="content" style="padding: 0 30px 30px;">
                                            <div style="background-color: #404040; border-radius: 8px; border-left: 4px solid #fbbf24; padding: 20px;">
                                                <h3 style="margin: 0 0 15px 0; color: #fbbf24; font-size: 16px; font-weight: 600;">💬 Continue the Conversation</h3>
                                                <p style="margin: 0 0 15px 0; color: #e0e0e0; line-height: 1.6; font-size: 15px;">
                                                    To continue working with Claude Code, simply <strong>reply to this email</strong> and type your next instructions.
                                                </p>
                                                <div style="background-color: #2d2d2d; padding: 15px; border-radius: 6px;">
                                                    <p style="margin: 0 0 10px 0; font-weight: 600; color: #d1d1d1; font-size: 14px;">💡 Example replies:</p>
                                                    <ul style="margin: 0; padding-left: 20px; color: #a1a1a1; line-height: 1.6;">
                                                        <li>"Please continue optimizing the code"</li>
                                                        <li>"Generate unit tests for this function"</li>
                                                        <li>"Explain how this works"</li>
                                                        <li>"Add more detailed comments"</li>
                                                        <li>"Fix any potential bugs"</li>
                                                        <li>"Refactor this for better performance"</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>

                                    <!-- Footer -->
                                    <tr>
                                        <td class="content" style="padding: 20px 30px; background-color: #333333; border-top: 1px solid #525252;">
                                            <table role="presentation" style="width: 100%;">
                                                <tr>
                                                    <td style="font-size: 12px; color: #a1a1a1; line-height: 1.5;">
                                                        <p style="margin: 6px 0;">
                                                            <span style="color: #d1d1d1;">🆔 Session ID:</span> 
                                                            <code style="background-color: #404040; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; color: #e0e0e0;">{{sessionId}}</code>
                                                        </p>
                                                        <p style="margin: 6px 0;">🔒 <strong>Security:</strong> Do not forward this email. Session expires in 24 hours.</p>
                                                        <p style="margin: 6px 0;">📧 Automated message from Claude-Code-Remote</p>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                `,
                text: `
[Claude-Code-Remote #{{token}}] Claude Code Task Completed - {{projectDir}} | {{shortQuestion}}

═══════════════════════════════════════════════════════════════════════════════════
🎉 CLAUDE CODE TASK COMPLETED
═══════════════════════════════════════════════════════════════════════════════════

📁 Project: {{projectDir}}
⏰ Time: {{timestamp}}
✅ Status: {{type}}

───────────────────────────────────────────────────────────────────────────────────
📝 YOUR QUESTION:
───────────────────────────────────────────────────────────────────────────────────
{{userQuestion}}

───────────────────────────────────────────────────────────────────────────────────
🤖 CLAUDE'S RESPONSE:
───────────────────────────────────────────────────────────────────────────────────
{{claudeResponse}}

═══════════════════════════════════════════════════════════════════════════════════
💬 CONTINUE THE CONVERSATION
═══════════════════════════════════════════════════════════════════════════════════

To continue working with Claude Code, simply reply to this email and type your 
next instructions.

💡 EXAMPLE REPLIES:
  • "Please continue optimizing the code"
  • "Generate unit tests for this function"
  • "Explain how this works"
  • "Add more detailed comments"
  • "Fix any potential bugs"  
  • "Refactor this for better performance"

───────────────────────────────────────────────────────────────────────────────────
📋 SESSION INFO
───────────────────────────────────────────────────────────────────────────────────
🆔 Session ID: {{sessionId}}
🔒 Security: Do not forward this email. Session expires in 24 hours.
📧 Automated message from Claude-Code-Remote

═══════════════════════════════════════════════════════════════════════════════════
                `
            },
            waiting: {
                subject: '[Claude-Code-Remote #{{token}}] Claude Code Waiting for Input - {{project}}',
                html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Claude Code Waiting for Input</title>
                    <style>
                        @media only screen and (max-width: 600px) {
                            .container { width: 100% !important; padding: 10px !important; }
                            .content { padding: 15px !important; }
                            h2 { font-size: 18px !important; }
                            h3 { font-size: 16px !important; }
                            h4 { font-size: 14px !important; }
                        }
                    </style>
                </head>
                <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #e0e0e0; background-color: #1a1a1a;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 20px;">
                                <table class="container" role="presentation" style="max-width: 600px; width: 100%; margin: 0 auto; background-color: #2d2d2d; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid #404040;">
                                    <!-- Header -->
                                    <tr>
                                        <td class="content" style="padding: 40px 30px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #1a1a1a; text-align: center;">
                                            <h1 style="margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">⏳ Waiting for Input</h1>
                                            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.8;">Claude Code needs your guidance</p>
                                        </td>
                                    </tr>
                                    
                                    <!-- Project Info -->
                                    <tr>
                                        <td class="content" style="padding: 30px;">
                                            <table role="presentation" style="width: 100%; background-color: #4a4a4a; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid #666666;">
                                                <tr>
                                                    <td style="padding: 10px 0; font-size: 15px; font-weight: 500;">
                                                        <span style="color: #f0f0f0; display: inline-block; width: 80px;">📁 Project:</span>
                                                        <span style="color: #f59e0b; font-weight: 600;">{{projectDir}}</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 10px 0; font-size: 15px; font-weight: 500; border-top: 1px solid #666666;">
                                                        <span style="color: #f0f0f0; display: inline-block; width: 80px;">⏰ Time:</span>
                                                        <span style="color: #d0d0d0;">{{timestamp}}</span>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td style="padding: 10px 0; font-size: 15px; font-weight: 500; border-top: 1px solid #666666;">
                                                        <span style="color: #f0f0f0; display: inline-block; width: 80px;">⏳ Status:</span>
                                                        <span style="color: #f59e0b; font-weight: 600;">{{type}}</span>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>

                                    <!-- Waiting Message -->
                                    <tr>
                                        <td class="content" style="padding: 0 30px 25px;">
                                            <div style="background-color: #404040; border-radius: 8px; border-left: 4px solid #f59e0b; padding: 20px; margin-bottom: 20px;">
                                                <h3 style="margin: 0 0 15px 0; color: #f59e0b; font-size: 16px; font-weight: 600;">⏳ Processing Status</h3>
                                                <div style="background-color: #2d2d2d; padding: 15px; border-radius: 6px; color: #e0e0e0; line-height: 1.6; word-wrap: break-word;">
                                                    {{message}}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>

                                    <!-- Please Provide Guidance -->
                                    <tr>
                                        <td class="content" style="padding: 0 30px 30px;">
                                            <div style="background-color: #404040; border-radius: 8px; border-left: 4px solid #60a5fa; padding: 20px;">
                                                <h3 style="margin: 0 0 15px 0; color: #60a5fa; font-size: 16px; font-weight: 600;">💬 Provide Guidance</h3>
                                                <p style="margin: 0 0 15px 0; color: #e0e0e0; line-height: 1.6; font-size: 15px;">
                                                    Claude needs your further guidance. Please <strong>reply to this email</strong> and tell Claude what to do next.
                                                </p>
                                                <div style="background-color: #2d2d2d; padding: 15px; border-radius: 6px;">
                                                    <p style="margin: 0 0 10px 0; font-weight: 600; color: #d1d1d1; font-size: 14px;">💡 Example replies:</p>
                                                    <ul style="margin: 0; padding-left: 20px; color: #a1a1a1; line-height: 1.6;">
                                                        <li>"Please read this file's content"</li>
                                                        <li>"Help me fix this error"</li>
                                                        <li>"Continue the previous work"</li>
                                                        <li>"Commit these changes to git"</li>
                                                        <li>"Run the tests"</li>
                                                        <li>"Explain what this does"</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>

                                    <!-- Footer -->
                                    <tr>
                                        <td class="content" style="padding: 20px 30px; background-color: #333333; border-top: 1px solid #525252;">
                                            <table role="presentation" style="width: 100%;">
                                                <tr>
                                                    <td style="font-size: 12px; color: #a1a1a1; line-height: 1.5;">
                                                        <p style="margin: 6px 0;">
                                                            <span style="color: #d1d1d1;">🆔 Session ID:</span> 
                                                            <code style="background-color: #404040; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; color: #e0e0e0;">{{sessionId}}</code>
                                                        </p>
                                                        <p style="margin: 6px 0;">🔒 <strong>Security:</strong> Do not forward this email. Session expires in 24 hours.</p>
                                                        <p style="margin: 6px 0;">📧 Automated message from Claude-Code-Remote</p>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                `,
                text: `
[Claude-Code-Remote #{{token}}] Claude Code Waiting for Input - {{projectDir}}

═══════════════════════════════════════════════════════════════════════════════════
⏳ CLAUDE CODE WAITING FOR INPUT
═══════════════════════════════════════════════════════════════════════════════════

📁 Project: {{projectDir}}
⏰ Time: {{timestamp}}
⏳ Status: {{type}}

───────────────────────────────────────────────────────────────────────────────────
⏳ PROCESSING STATUS:
───────────────────────────────────────────────────────────────────────────────────
{{message}}

═══════════════════════════════════════════════════════════════════════════════════
💬 PROVIDE GUIDANCE
═══════════════════════════════════════════════════════════════════════════════════

Claude needs your further guidance. Please reply to this email and tell Claude 
what to do next.

💡 EXAMPLE REPLIES:
  • "Please read this file's content"
  • "Help me fix this error"
  • "Continue the previous work"
  • "Commit these changes to git"
  • "Run the tests"
  • "Explain what this does"

───────────────────────────────────────────────────────────────────────────────────
📋 SESSION INFO
───────────────────────────────────────────────────────────────────────────────────
🆔 Session ID: {{sessionId}}
🔒 Security: Do not forward this email. Session expires in 24 hours.
📧 Automated message from Claude-Code-Remote

═══════════════════════════════════════════════════════════════════════════════════
                `
            }
        };

        return templates[type] || templates.completed;
    }

    validateConfig() {
        if (!this.config.smtp) {
            return { valid: false, error: 'SMTP configuration required' };
        }
        
        if (!this.config.smtp.host) {
            return { valid: false, error: 'SMTP host required' };
        }
        
        if (!this.config.smtp.auth || !this.config.smtp.auth.user || !this.config.smtp.auth.pass) {
            return { valid: false, error: 'SMTP authentication required' };
        }
        
        if (!this.config.to) {
            return { valid: false, error: 'Recipient email required' };
        }

        return { valid: true };
    }

    async test() {
        try {
            if (!this.transporter) {
                throw new Error('Email transporter not initialized');
            }

            // Verify SMTP connection
            await this.transporter.verify();
            
            // Send test email
            const testNotification = {
                type: 'completed',
                title: 'Claude-Code-Remote Test',
                message: 'This is a test email to verify that the email notification function is working properly.',
                project: 'Claude-Code-Remote-Test',
                metadata: {
                    test: true,
                    timestamp: new Date().toISOString()
                }
            };

            const result = await this._sendImpl(testNotification);
            return result;
        } catch (error) {
            this.logger.error('Email test failed:', error.message);
            return false;
        }
    }

    getStatus() {
        const baseStatus = super.getStatus();
        return {
            ...baseStatus,
            configured: this.validateConfig().valid,
            supportsRelay: true,
            smtp: {
                host: this.config.smtp?.host || 'not configured',
                port: this.config.smtp?.port || 'not configured',
                secure: this.config.smtp?.secure || false
            },
            recipient: this.config.to || 'not configured'
        };
    }
}

module.exports = EmailChannel;