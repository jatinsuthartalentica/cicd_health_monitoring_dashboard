import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const INTERVAL = Number(process.env.INTERVAL_SECONDS || 8) * 1000;
const FAILURE_RATE = Number(process.env.FAILURE_RATE || 0.3);
const PROVIDER = process.env.PROVIDER || 'github';
const PIPELINE = process.env.PIPELINE || 'sample-repo/main';
const MODE = process.env.MODE || 'simulate'; // 'simulate' | 'github'
const WORKER_FETCH_RUNS = Number(process.env.WORKER_FETCH_RUNS || 100);

// GitHub config
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // optional
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

function randomCommit() {
  const chars = 'abcdef0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function simulateOnce() {
  const duration = 30 + Math.random() * 270;
  const status = Math.random() < FAILURE_RATE ? 'failure' : 'success';
  const now = new Date();
  const started = new Date(now.getTime() - duration * 1000);
  const payload = {
    provider: PROVIDER,
    pipeline: PIPELINE,
    status,
    duration_sec: duration,
    started_at: started.toISOString(),
    finished_at: now.toISOString(),
    commit: randomCommit(),
    branch: PIPELINE.includes('/') ? PIPELINE.split('/').pop() : 'main',
    logs: `Simulated ${status} build taking ${duration.toFixed(1)}s`,
  };
  try {
    const r = await axios.post(`${API_BASE}/api/ingest`, payload, { timeout: 10000 });
    console.log('ingested build', r.data.id);
  } catch (e) {
    console.log('ingest failed', e?.response?.status, e?.message);
  }
}

function mapGhStatus(run) {
  // GitHub Actions statuses
  // conclusion: success, failure, cancelled, neutral, skipped, timed_out, action_required
  // status: queued, in_progress, completed
  if (run.status !== 'completed') return 'running';
  if (run.conclusion === 'success') return 'success';
  return 'failure';
}

async function pollGithubOnce() {
  async function pollOne(owner, repo, repoToken) {
    const headers = { 'Accept': 'application/vnd.github+json' };
    const tokenToUse = repoToken || GITHUB_TOKEN;
    if (tokenToUse) headers['Authorization'] = `Bearer ${tokenToUse}`;
    try {
      const perPage = 100;
      let page = 1;
      let fetched = 0;
      let totalRuns = 0;
      while (fetched < WORKER_FETCH_RUNS) {
        const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=${perPage}&page=${page}`;
        const resp = await axios.get(url, { headers, timeout: 10000 });
        const runs = resp.data?.workflow_runs || [];
        if (runs.length === 0) break;
        totalRuns += runs.length;
        for (const r of runs) {
          const status = mapGhStatus(r);
          const started = r.run_started_at ? new Date(r.run_started_at) : (r.created_at ? new Date(r.created_at) : new Date());
          const finished = r.updated_at ? new Date(r.updated_at) : new Date();
          const durationSec = Math.max(0, (finished - started) / 1000);
          const branch = r.head_branch || 'main';
          const payload = {
            provider: 'github',
            pipeline: `${owner}/${repo}/${branch}`,
            status,
            duration_sec: durationSec,
            started_at: started.toISOString(),
            finished_at: finished.toISOString(),
            commit: (r.head_sha || '').slice(0, 8),
            branch,
            logs: r.html_url,
            external_id: String(r.id),
          };
          try {
            await axios.post(`${API_BASE}/api/ingest`, payload, { timeout: 10000 });
          } catch (e) {
            console.log('github ingest failed', owner, repo, e?.response?.status, e?.message);
          }
          fetched++;
          if (fetched >= WORKER_FETCH_RUNS) break;
        }
        page++;
      }
      console.log(`polled ${fetched} runs from GitHub for ${owner}/${repo}`);
    } catch (e) {
      console.log('github poll failed', owner, repo, e?.response?.status, e?.message);
    }
  }

  // Get repo list from API (internal endpoint to include tokens)
  try {
    let repos = [];
    try {
      const res = await axios.get(`${API_BASE}/api/internal/repos`, { headers: { 'X-Internal-Token': INTERNAL_TOKEN }, timeout: 8000 });
      repos = Array.isArray(res.data) ? res.data : [];
    } catch {
      // fallback to public list without tokens
      const res = await axios.get(`${API_BASE}/api/repos`, { timeout: 8000 });
      repos = Array.isArray(res.data) ? res.data : [];
    }
    if (repos.length === 0) {
      // Fallback to single repo via env
      if (GITHUB_OWNER && GITHUB_REPO) {
        await pollOne(GITHUB_OWNER, GITHUB_REPO, null);
      } else {
        console.log('No repositories configured');
      }
    } else {
      for (const r of repos) {
        await pollOne(r.owner, r.repo, r.token || null);
      }
    }
  } catch (e) {
    console.log('failed to fetch repos from API', e?.message);
  }
}

(async function run() {
  console.log('Worker targeting', API_BASE, 'mode=', MODE);
  await new Promise(r => setTimeout(r, 3000));
  while (true) {
    if (MODE === 'github') {
      await pollGithubOnce();
    } else {
      await simulateOnce();
    }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
})();
