// functions/notify.js
import nodemailer from 'nodemailer';

export async function handler(event, context) {
  try {
    const { to, subject, text } = JSON.parse(event.body);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Dovolenky" <${process.env.GMAIL_USER}>`,
      to: to || process.env.NOTIFY_EMAIL,
      subject: subject || 'Nová žiadosť o dovolenku',
      text: text || 'V aplikácii bola vytvorená nová žiadosť.',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Email sent successfully ✅' }),
    };
  } catch (error) {
    console.error('Email send error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Email failed ❌', error: error.message }),
    };
  }
}
