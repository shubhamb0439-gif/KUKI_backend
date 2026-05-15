const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;

async function sendEmail({ to, subject, text, html }) {
  await sgMail.send({ from: FROM_EMAIL, to, subject, text, html: html || `<p>${text}</p>` });
}

module.exports = { sendEmail };
