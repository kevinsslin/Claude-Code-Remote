#!/usr/bin/env node

/**
 * Test SMTP connection using environment variables
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

async function testSMTP() {
    console.log('🔧 Testing SMTP connection...\n');
    
    const config = {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    };
    
    console.log('📋 SMTP Configuration:');
    console.log(`   Host: ${config.host}`);
    console.log(`   Port: ${config.port}`);
    console.log(`   Secure: ${config.secure}`);
    console.log(`   User: ${config.auth.user}`);
    console.log(`   Pass: ${'*'.repeat(config.auth.pass?.length || 0)}\n`);
    
    try {
        const transporter = nodemailer.createTransport(config);
        
        console.log('🔄 Verifying connection...');
        await transporter.verify();
        console.log('✅ SMTP connection successful!\n');
        
        console.log('📧 Sending test email...');
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || `Claude Code Remote <${process.env.SMTP_USER}>`,
            to: process.env.EMAIL_TO,
            subject: 'Claude Code Remote - SMTP Test',
            text: 'This is a test email from Claude Code Remote. If you receive this, SMTP is working correctly!'
        });
        
        console.log(`✅ Test email sent successfully!`);
        console.log(`📧 Message ID: ${info.messageId}`);
        console.log(`📬 To: ${process.env.EMAIL_TO}`);
        
    } catch (error) {
        console.error('❌ SMTP test failed:', error.message);
        
        if (error.code === 'EAUTH') {
            console.error('\n💡 Authentication failed. Please check:');
            console.error('   - Gmail App Password is correct');
            console.error('   - Two-factor authentication is enabled');
            console.error('   - Email credentials in .env file');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('\n💡 Connection timeout. Please check:');
            console.error('   - Internet connection');
            console.error('   - Firewall settings');
            console.error('   - SMTP host and port');
        }
    }
}

testSMTP().catch(console.error);