import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { notifyFailure } from './alerting.js';
import crypto from 'crypto';
import axios from 'axios';

dotenv.config();
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8080;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const ENC_KEY_STR = process.env.ENCRYPTION_KEY || '';

function getKey() {
  // derive 32-byte key from env string
  return crypto.createHash('sha256').update(ENC_KEY_STR).digest();
}
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64'); // iv(12) + tag(16) + data
}
function decrypt(encB64) {
  if (!encB64) return null;
  const buf = Buffer.from(encB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

app.use(cors());
app.use(express.json());

app.get('/api/metrics', async (req, res) => {
  const { owner, repo, branch } = req.query || {};
  const where = {};
  if (owner && repo) where.pipeline = { startsWith: `${owner}/${repo}/` };
  if (branch) where.branch = String(branch);
  const total = await prisma.build.count({ where });
  const success = await prisma.build.count({ where: { ...where, status: 'success' } });
  const avgRow = await prisma.build.aggregate({ _avg: { durationSec: true }, where });
  const last = await prisma.build.findFirst({ where, orderBy: { id: 'desc' }, select: { status: true } });
  res.json({
    success_rate: total ? success / total : 0,
    avg_build_time_sec: Number(avgRow._avg.durationSec || 0),
    last_status: last?.status ?? null,
    total_builds: total,
  });
});

app.get('/api/builds', async (req, res) => {
  const limit = Number(req.query.limit || 20);
  const { owner, repo, branch } = req.query || {};
  const where = {};
  if (owner && repo) where.pipeline = { startsWith: `${owner}/${repo}/` };
  if (branch) where.branch = String(branch);
  const rows = await prisma.build.findMany({ where, orderBy: { id: 'desc' }, take: limit });
  res.json(rows);
});

// Branch list for a repo based on ingested builds
app.get('/api/branches', async (req, res) => {
  const { owner, repo } = req.query || {};
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo are required' });
  const rows = await prisma.build.findMany({
    where: { pipeline: { startsWith: `${owner}/${repo}/` } },
    distinct: ['branch'],
    select: { branch: true },
    orderBy: { branch: 'asc' },
  });
  res.json(rows.map(r => r.branch).filter(Boolean));
});

app.post('/api/ingest', async (req, res) => {
  const payload = req.body || {};
  const data = {
    provider: payload.provider,
    pipeline: payload.pipeline,
    status: payload.status,
    durationSec: payload.duration_sec,
    startedAt: payload.started_at ? new Date(payload.started_at) : new Date(),
    finishedAt: payload.finished_at ? new Date(payload.finished_at) : null,
    commit: payload.commit ?? null,
    branch: payload.branch ?? null,
    logs: payload.logs ?? null,
    externalId: payload.external_id ?? null,
  };

  let b;
  if (data.externalId) {
    // upsert by externalId to dedupe
    b = await prisma.build.upsert({
      where: { externalId: data.externalId },
      update: data,
      create: data,
    });
  } else {
    b = await prisma.build.create({ data });
  }
  res.json(b);
});

function mapGhStatus(run) {
  if (run.status !== 'completed') return 'running';
  if (run.conclusion === 'success') return 'success';
  return 'failure';
}

async function fetchGithubAndUpsert(owner, repo, token) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const perPage = 100;
  const MAX = Number(process.env.MANUAL_FETCH_RUNS || 200);
  let page = 1;
  let fetched = 0;
  let count = 0;
  while (fetched < MAX) {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=${perPage}&page=${page}`;
    const resp = await axios.get(url, { headers, timeout: 10000 });
    const runs = resp.data?.workflow_runs || [];
    if (runs.length === 0) break;
    for (const r of runs) {
      const status = mapGhStatus(r);
      const started = r.run_started_at ? new Date(r.run_started_at) : (r.created_at ? new Date(r.created_at) : new Date());
      const finished = r.updated_at ? new Date(r.updated_at) : null;
      const durationSec = finished ? Math.max(0, (finished - started) / 1000) : 0;
      const branch = r.head_branch || 'main';
      const data = {
        provider: 'github',
        pipeline: `${owner}/${repo}/${branch}`,
        status,
        durationSec,
        startedAt: started,
        finishedAt: finished,
        commit: (r.head_sha || '').slice(0, 8),
        branch,
        logs: r.html_url,
        externalId: String(r.id),
      };
      let b = await prisma.build.upsert({
        where: { externalId: data.externalId },
        update: data,
        create: data,
      });
      if ((b.status || '').toLowerCase() === 'failure') {
        // Notify only once per run (email dedupe via alertedAt) and only for recent runs
        const startedAt = b.startedAt || new Date();
        const ageMin = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60000);
        const MAX_MIN = Number(process.env.ALERT_MAX_AGE_MINUTES || 60);
        if (!b.alertedAt && ageMin <= MAX_MIN) {
          await notifyFailure({
            provider: b.provider,
            pipeline: b.pipeline,
            status: b.status,
            duration_sec: b.durationSec,
            branch: b.branch,
            commit: b.commit,
            startedAt: b.startedAt,
          });
          b = await prisma.build.update({ where: { id: b.id }, data: { alertedAt: new Date() } });
        }
      }
      count++;
      fetched++;
      if (fetched >= MAX) break;
    }
    page++;
  }
  return count;
}

// Manual update trigger for a repository
app.post('/api/repos/:id/update', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const repo = await prisma.repository.findUnique({ where: { id } });
    if (!repo) return res.status(404).json({ error: 'not found' });
    const token = decrypt(repo.tokenEnc || null);
    const count = await fetchGithubAndUpsert(repo.owner, repo.repo, token);
    res.json({ ok: true, updated_runs: count });
  } catch (e) {
    res.status(500).json({ error: 'update failed' });
  }
});

// Build logs: fetch GitHub jobs & steps and render text summary
app.get('/api/builds/:id/logs', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send('invalid id');
  try {
    const b = await prisma.build.findUnique({ where: { id } });
    if (!b) return res.status(404).send('not found');
    // Expect pipeline as owner/repo/branch and externalId as GitHub run id
    const parts = String(b.pipeline || '').split('/');
    if (parts.length < 2 || !b.externalId) return res.status(400).send('no external logs available');
    const owner = parts[0];
    const repo = parts[1];
    // Load per-repo token if present
    const repoRow = await prisma.repository.findFirst({ where: { owner, repo } });
    const token = repoRow?.tokenEnc ? decrypt(repoRow.tokenEnc) : undefined;
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Fetch jobs for the run and format
    let page = 1; const perPage = 100; let lines = [];
    while (true) {
      const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${b.externalId}/jobs?per_page=${perPage}&page=${page}`;
      const r = await axios.get(url, { headers, timeout: 10000 });
      const jobs = r.data?.jobs || [];
      if (jobs.length === 0) break;
      for (const j of jobs) {
        lines.push(`# Job: ${j.name} [${j.status}${j.conclusion?`/${j.conclusion}`:''}]`);
        if (j.started_at) lines.push(`  started: ${j.started_at}`);
        if (j.completed_at) lines.push(`  completed: ${j.completed_at}`);
        const steps = j.steps || [];
        for (const s of steps) {
          lines.push(`  - ${s.name} [${s.status}${s.conclusion?`/${s.conclusion}`:''}]`);
        }
        lines.push('');
      }
      page++;
    }
    if (lines.length === 0) lines.push('No job/step details available. Open run in browser for full logs: ' + (b.logs || ''));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(lines.join('\n'));
 } catch (e) {
  console.error('build logs error', e?.response?.status, e?.message);
  res.status(500).send('logs_unavailable');
 }
});

// Full job logs (gzip from GitHub), optional tail=N lines
app.get('/api/builds/:id/logs/full', async (req, res) => {
  const id = Number(req.params.id);
  const tail = Math.max(0, Number(req.query.tail || 0));
  if (!id) return res.status(400).send('invalid id');
  try {
    const b = await prisma.build.findUnique({ where: { id } });
    if (!b) return res.status(404).send('not found');
    const parts = String(b.pipeline || '').split('/');
    if (parts.length < 2 || !b.externalId) return res.status(400).send('no external logs available');
    const owner = parts[0];
    const repo = parts[1];
    const repoRow = await prisma.repository.findFirst({ where: { owner, repo } });
    const token = repoRow?.tokenEnc ? decrypt(repoRow.tokenEnc) : undefined;
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // 1) list jobs for the run
    const jobs = [];
    let page = 1; const perPage = 100;
    while (true) {
      const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${b.externalId}/jobs?per_page=${perPage}&page=${page}`;
      const r = await axios.get(url, { headers, timeout: 10000 });
      const batch = r.data?.jobs || [];
      if (batch.length === 0) break;
      jobs.push(...batch);
      page++;
    }
    if (jobs.length === 0) return res.status(404).send('no_jobs');

    // 2) for each job, download logs stream (gzip), gunzip, and collect text
    const zlib = await import('node:zlib');
    const logsByJob = [];
    for (const j of jobs) {
      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${j.id}/logs`;
        const r = await axios.get(url, { headers, responseType: 'arraybuffer', timeout: 20000 });
        const buf = Buffer.from(r.data);
        const gunzipped = zlib.gunzipSync(buf).toString('utf-8');
        logsByJob.push({ name: j.name, text: gunzipped });
      } catch (e) {
        logsByJob.push({ name: j.name, text: `Failed to fetch logs for job ${j.name}: ${e?.response?.status || ''} ${e?.message || e}` });
      }
    }

    // 3) concatenate with headers
    let all = [];
    for (const item of logsByJob) {
      all.push(`===== ${item.name} =====`);
      const lines = item.text.split(/\r?\n/);
      all.push(...lines);
      all.push('');
    }

    // 4) tail if requested
    if (tail > 0 && all.length > tail) {
      all = all.slice(all.length - tail);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(all.join('\n'));
  } catch (e) {
    console.error('full logs error', e?.response?.status, e?.message);
    res.status(500).send('full_logs_unavailable');
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

// Repositories CRUD
app.get('/api/repos', async (req, res) => {
  const rows = await prisma.repository.findMany({ orderBy: { id: 'desc' } });
  // hide tokenEnc
  res.json(rows.map(({ tokenEnc, ...rest }) => rest));
});

app.post('/api/repos', async (req, res) => {
  const { owner, repo, branch, token } = req.body || {};
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo are required' });
  try {
    const normBranch = (typeof branch === 'string' && branch.trim() === '') ? null : (branch ?? null);
    const data = { owner, repo, branch: normBranch };
    if (token) data.tokenEnc = encrypt(token);
    const r = await prisma.repository.upsert({
      where: { owner_repo_branch: { owner, repo, branch: normBranch } },
      update: data,
      create: data,
    });
    const { tokenEnc, ...resp } = r;
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: 'failed to save repository' });
  }
});

app.delete('/api/repos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    await prisma.repository.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: 'not found' });
  }
});

// Internal endpoint to get repos with decrypted tokens
app.get('/api/internal/repos', async (req, res) => {
  const token = req.header('X-Internal-Token') || '';
  if (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const rows = await prisma.repository.findMany({ orderBy: { id: 'desc' } });
  const out = rows.map(r => ({ id: r.id, owner: r.owner, repo: r.repo, branch: r.branch, token: decrypt(r.tokenEnc || null) }));
  res.json(out);
});

app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
