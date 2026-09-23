const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false }));
app.disable('x-powered-by');

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length && isProd) {
  console.warn(`Missing environment variables: ${missing.join(', ')}`);
}

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

const authClient = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function validUrlBase(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function requireUser(req, res, next) {
  try {
    if (!authClient || !supabase) return res.status(503).json({ error: 'Supabase is not configured yet.' });
    const header = req.headers.authorization || '';
    const accessToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!accessToken) return res.status(401).json({ error: 'Sign in required.' });
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.user = data.user;
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: 'Authentication failed.' });
  }
}

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    appName: 'Njochie'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Njochie', databaseConfigured: Boolean(supabase) });
});

app.post('/api/messages', requireUser, async (req, res) => {
  try {
    const { title, message, question, answer, expiresAt, maxAttempts, maxViews, oneTime } = req.body;
    if (!title || !message || !question || !answer) {
      return res.status(400).json({ error: 'Title, message, question and answer are required.' });
    }
    const safeMaxAttempts = Math.min(Math.max(Number(maxAttempts) || 5, 1), 20);
    const safeMaxViews = Math.min(Math.max(Number(maxViews) || 1, 1), 100);
    const finalMaxViews = oneTime ? 1 : safeMaxViews;
    const tokenValue = token();
    const answerHash = crypto.createHash('sha256').update(normalize(answer)).digest('hex');

    const { data, error } = await supabase.from('messages').insert({
      creator_id: req.user.id,
      token: tokenValue,
      title: String(title).trim().slice(0, 160),
      message: String(message).trim(),
      question: String(question).trim().slice(0, 300),
      answer_hash: answerHash,
      max_attempts: safeMaxAttempts,
      max_views: finalMaxViews,
      expires_at: expiresAt || null
    }).select('id, token, title, question, max_attempts, max_views, expires_at, active, created_at').single();

    if (error) throw error;
    res.status(201).json({ ...data, shareUrl: `${validUrlBase(req)}/m/${data.token}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create the message.' });
  }
});

app.get('/api/messages', requireUser, async (req, res) => {
  const { data, error } = await supabase.from('messages')
    .select('id, token, title, question, max_attempts, attempts, max_views, views, expires_at, active, created_at')
    .eq('creator_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load your messages.' });
  res.json(data.map((m) => ({ ...m, shareUrl: `${validUrlBase(req)}/m/${m.token}` })));
});

app.post('/api/messages/:id/disable', requireUser, async (req, res) => {
  const { data, error } = await supabase.from('messages').update({ active: false })
    .eq('id', req.params.id).eq('creator_id', req.user.id).select('id').single();
  if (error || !data) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

app.get('/api/public/:token', async (req, res) => {
  const { data, error } = await supabase.from('messages')
    .select('token, title, question, attempts, max_attempts, views, max_views, expires_at, active')
    .eq('token', req.params.token).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'This Njochie message does not exist.' });
  res.json(data);
});

app.post('/api/public/:token/reveal', async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: 'Njochie is not configured yet.' });
    const answer = normalize(req.body.answer);
    if (!answer) return res.status(400).json({ error: 'Please enter an answer.' });

    const { data, error } = await supabase.rpc('reveal_message', {
      p_token: req.params.token,
      p_answer: answer
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) return res.status(404).json({ error: 'This Njochie message is unavailable.' });
    if (result.status === 'revealed') return res.json({ status: 'revealed', title: result.title, message: result.message });
    res.status(403).json({ status: result.status, error: result.error_message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong while checking the answer.' });
  }
});

app.use('/m/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'message.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Njochie running at http://localhost:${PORT}`));
}

module.exports = app;
