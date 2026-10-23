// In tests (NODE_ENV=test and EMAIL_OUTBOX=memory) emails are collected here
// instead of being sent, so automated tests can read sign-in codes and links
// exactly as a person would read their inbox. Never active in production.
const messages = [];
const enabled = () => process.env.NODE_ENV === 'test' && process.env.EMAIL_OUTBOX === 'memory';
function push(to, subject, html) {
  messages.push({ to, subject, html: String(html || ''), at: Date.now() });
  return { success: true, id: `test-${messages.length}` };
}
const last = (to) => [...messages].reverse().find((m) => !to || m.to === to);
const clear = () => { messages.length = 0; };
module.exports = { enabled, push, messages, last, clear };
