// netlify/functions/notify.js
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    const FROM_EMAIL = process.env.NOTIFY_EMAIL; // musí byť overený odosielateľ v SendGrid

    if (!SENDGRID_API_KEY || !FROM_EMAIL) {
      return { statusCode: 500, body: 'Missing SENDGRID_API_KEY or NOTIFY_EMAIL env vars.' };
    }

    const body = JSON.parse(event.body || '{}');
    const to = body.to || FROM_EMAIL; // fallback
    const subject = body.subject || 'Notifikácia z Dovolenky';
    const text = body.text || 'Testovacia správa';
    const html = body.html || null;

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: 'Dovolenky' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        ...(html ? [{ type: 'text/html', value: html }] : [])
      ]
    };

    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { statusCode: resp.status, body: `SendGrid error: ${errText || resp.statusText}` };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, sentTo: to }) };
  } catch (e) {
    return { statusCode: 500, body: String(e?.message || e) };
  }
};