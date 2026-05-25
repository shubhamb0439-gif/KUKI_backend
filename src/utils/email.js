const { EmailClient } = require('@azure/communication-email');

let client;
function getClient() {
  if (!client) client = new EmailClient(process.env.AZURE_COMMUNICATION_CONNECTION_STRING);
  return client;
}

async function sendEmail({ to, subject, text, html }) {
  await getClient().beginSend({
    senderAddress: process.env.AZURE_COMMUNICATION_FROM_EMAIL || 'donotreply@kuki-app.com',
    recipients: { to: [{ address: to }] },
    content: {
      subject,
      plainText: text,
      html: html || `<p>${text}</p>`,
    },
  });
}

module.exports = { sendEmail };
