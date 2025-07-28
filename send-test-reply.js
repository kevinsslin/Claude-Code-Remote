/**
 * Send test email reply to relay service
 */

const nodemailer = require('nodemailer');
require('dotenv').config();

async function sendTestReply() {
    console.log('📧 Sending test email reply...\n');
    
    // Create test SMTP transporter (using environment variables)
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
    
    // Generate or use test token from environment
    let testToken = process.env.TEST_TOKEN;
    
    if (!testToken) {
        // Try to read latest token from session map
        try {
            const sessionMapPath = process.env.SESSION_MAP_PATH || './src/data/session-map.json';
            if (require('fs').existsSync(sessionMapPath)) {
                const sessionMap = JSON.parse(require('fs').readFileSync(sessionMapPath, 'utf8'));
                const tokens = Object.keys(sessionMap);
                testToken = tokens[tokens.length - 1]; // Use latest token
            }
        } catch (error) {
            console.log('Could not read session map, using generated token');
        }
        
        // Fallback: generate a test token
        if (!testToken) {
            testToken = Math.random().toString(36).substr(2, 8).toUpperCase();
        }
    }
    
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: process.env.SMTP_USER, // Self-send for testing
        subject: `Re: [Claude-Code-Remote #${testToken}] Claude Code Task Completed - Claude-Code-Remote`,
        text: 'Please explain the basic principles of quantum computing',
        replyTo: process.env.EMAIL_TO || process.env.ALLOWED_SENDERS
    };
    
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Test email sent successfully!');
        console.log(`📧 Message ID: ${info.messageId}`);
        console.log(`📋 Token: ${testToken}`);
        console.log(`💬 Command: ${mailOptions.text}`);
        console.log('\n🔍 Now monitoring relay service logs...');
        
        // Wait a few seconds for email processing
        setTimeout(() => {
            console.log('\n📋 Please check relay-debug.log file for processing logs');
        }, 5000);
        
    } catch (error) {
        console.error('❌ Email sending failed:', error.message);
    }
}

sendTestReply().catch(console.error);