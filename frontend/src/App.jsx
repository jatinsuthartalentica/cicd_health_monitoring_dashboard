import React, { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin.replace(':3000', ':8080')

function cls(status){
  return status === 'success' ? {color:'#17d47a'} : status === 'failure' ? {color:'#ff6b6b'} : {color:'#f1c40f'}
}

export default function App(){
  const [metrics, setMetrics] = useState({success_rate:0, avg_build_time_sec:0, last_status:null, total_builds:0})
  const [builds, setBuilds] = useState([])
  const [repos, setRepos] = useState([])
  const [form, setForm] = useState({ owner:'', repo:'', branch:'', token:'' })
  const [selected, setSelected] = useState(null) // {owner, repo}
  const [branch, setBranch] = useState('')
  const [branchOptions, setBranchOptions] = useState([])
  const [limit, setLimit] = useState(20)

  function qs(params){
    const sp = new URLSearchParams()
    Object.entries(params).forEach(([k,v])=>{ if(v!==undefined && v!==null && String(v).length>0) sp.set(k, String(v)) })
    const s = sp.toString()
    return s ? `?${s}` : ''
  }

  async function loadBranches(sel){
    if(!sel) { setBranchOptions([]); return }
    try{
      const arr = await fetch(`${API_BASE}/api/branches${qs({ owner: sel.owner, repo: sel.repo })}`).then(r=>r.json())
      setBranchOptions(Array.isArray(arr)?arr:[])
    }catch{ setBranchOptions([]) }
  }

  async function refresh(){
    try{
      const baseParams = selected ? { owner: selected.owner, repo: selected.repo } : {}
      const params = { ...baseParams, branch, limit }
      const m = await fetch(`${API_BASE}/api/metrics${qs({ ...baseParams, branch })}`).then(r=>r.json())
      const b = await fetch(`${API_BASE}/api/builds${qs(params)}`).then(r=>r.json())
      const rs = await fetch(`${API_BASE}/api/repos`).then(r=>r.json()).catch(()=>[])
      setMetrics(m); setBuilds(b)
      setRepos(Array.isArray(rs)?rs:[])
    }catch(e){ console.error(e) }
  }

  // Polling: recreate interval when filters change so it always uses latest selection
  useEffect(()=>{ 
    refresh(); 
    const t=setInterval(()=>{ refresh() },5000); 
    return ()=>clearInterval(t)
  },[selected?.owner, selected?.repo, branch, limit])

  // When selection changes, fetch branches, reset branch filter, and refresh immediately
  useEffect(()=>{ loadBranches(selected); setBranch(''); refresh() }, [selected?.owner, selected?.repo])
  // When branch changes, refresh filtered data
  useEffect(()=>{ refresh() }, [branch])
  // When limit changes, refresh
  useEffect(()=>{ refresh() }, [limit])

  const pct = Math.round((metrics.success_rate||0)*100)
  const recentDurations = [...builds].slice(0, 30).map(b => Number(b.durationSec||b.duration_sec||0)).reverse()
  const successCount = builds.filter(b=>b.status==='success').length
  const failureCount = builds.filter(b=>b.status==='failure').length

  return (
    <div style={{fontFamily:'Inter, Arial', background:'#0b1220', color:'#e6edf3', minHeight:'100vh'}}>
      <header style={{padding:'16px 24px', background:'#111a2c', borderBottom:'1px solid #23304d'}}>
        <h2>CI/CD Pipeline Health Dashboard</h2>
      </header>
      <div style={{padding:'24px'}}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px,1fr))', gap:16}}>
          <Card title="Success Rate">
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <DonutChart value={pct} size={72} />
              <div>
                <div style={{fontSize:22, fontWeight:600}}>{pct}%</div>
                <div style={{color:'#93a1b3', fontSize:12}}>{successCount} success • {failureCount} failure</div>
              </div>
            </div>
          </Card>
          <Card title="Average Build Time">
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <div style={{fontSize:22, fontWeight:600}}>{(metrics.avg_build_time_sec||0).toFixed(1)}s</div>
              <Sparkline data={recentDurations} width={140} height={40} />
            </div>
          </Card>
          <Card title="Last Build Status">
            <StatusPill status={metrics.last_status} />
          </Card>
          <Card title="Total Builds"><div style={{fontSize:22, fontWeight:600}}>{metrics.total_builds}</div></Card>
        </div>

        <h3 style={{marginTop:24}}>Monitored GitHub Repos</h3>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <div style={{background:'#111a2c', padding:16, border:'1px solid #23304d', borderRadius:8}}>
            <div style={{marginBottom:8, color:'#93a1b3'}}>Add repository</div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <Input placeholder="owner" value={form.owner} onChange={e=>setForm({...form, owner:e.target.value})} />
              <Input placeholder="repo" value={form.repo} onChange={e=>setForm({...form, repo:e.target.value})} />
              <Input placeholder="branch (optional)" value={form.branch} onChange={e=>setForm({...form, branch:e.target.value})} />
              <Input placeholder="GitHub token (optional)" value={form.token} onChange={e=>setForm({...form, token:e.target.value})} />
              <button onClick={async()=>{
                if(!form.owner||!form.repo) return;
                await fetch(`${API_BASE}/api/repos`,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form)});
                setForm({owner:'', repo:'', branch:'', token:''});
                refresh();
              }} style={btnStyle}>Add</button>
            </div>
          </div>
          <div style={{background:'#111a2c', padding:16, border:'1px solid #23304d', borderRadius:8}}>
            <div style={{marginBottom:8, color:'#93a1b3'}}>Configured repositories</div>
            <ul style={{listStyle:'none', margin:0, padding:0}}>
              {repos.map(r=> (
                <li key={r.id} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #23304d'}}>
                  <button onClick={()=>setSelected({owner:r.owner, repo:r.repo})} style={{background:'transparent', color:'#e6edf3', border:'none', textAlign:'left', cursor:'pointer'}}>
                    {r.owner}/{r.repo}{r.branch?` (${r.branch})`:''}
                    {selected && selected.owner===r.owner && selected.repo===r.repo && <span style={{color:'#93a1b3'}}> • selected</span>}
                  </button>
                  <div style={{display:'flex', gap:8}}>
                    <button onClick={async()=>{ await fetch(`${API_BASE}/api/repos/${r.id}/update`, {method:'POST'}); refresh(); }} style={{...btnStyle}}>Update</button>
                    <button onClick={async()=>{ await fetch(`${API_BASE}/api/repos/${r.id}`, {method:'DELETE'}); refresh(); }} style={{...btnStyle, background:'#2b344a'}}>Delete</button>
                  </div>
                </li>
              ))}
              {repos.length===0 && <li style={{color:'#93a1b3'}}>No repositories added yet.</li>}
            </ul>
          </div>
        </div>

        {selected && (
          <div style={{marginTop:16, background:'#111a2c', padding:16, border:'1px solid #23304d', borderRadius:8}}>
            <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
              <div style={{color:'#93a1b3'}}>Selected:</div>
              <div><strong>{selected.owner}/{selected.repo}</strong></div>
              <div style={{marginLeft:12, color:'#93a1b3'}}>Branch:</div>
              <select value={branch} onChange={e=>setBranch(e.target.value)} style={{background:'#0b1220', color:'#e6edf3', border:'1px solid #23304d', borderRadius:6, padding:'8px 10px'}}>
                <option value="">All</option>
                {branchOptions.map(b => (<option key={b} value={b}>{b}</option>))}
              </select>
              <div style={{marginLeft:12, color:'#93a1b3'}}>Rows:</div>
              <select value={limit} onChange={e=>setLimit(Number(e.target.value))} style={{background:'#0b1220', color:'#e6edf3', border:'1px solid #23304d', borderRadius:6, padding:'8px 10px'}}>
                {[20,50,100].map(n => (<option key={n} value={n}>{n}</option>))}
              </select>
              <button onClick={()=>{ setSelected(null); setBranch(''); setBranchOptions([]); }} style={{...btnStyle, background:'#2b344a'}}>Clear selection</button>
            </div>
          </div>
        )}

        <h3 style={{marginTop:24}}>Latest Builds</h3>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
          <thead>
            <tr>
              <Th>ID</Th><Th>Provider</Th><Th>Pipeline</Th><Th>Status</Th><Th>Duration</Th><Th>Commit</Th><Th>Branch</Th>
            </tr>
          </thead>
          <tbody>
            {builds.map((b, i)=> (
              <tr key={b.id} style={{borderBottom:'1px solid #23304d', background: i%2===1?'#0e1629':'transparent'}}>
                <Td>{b.id}</Td>
                <Td>{b.provider}</Td>
                <Td>{b.pipeline}</Td>
                <Td>
                  <StatusPill status={b.status} />
                </Td>
                <Td>{(b.durationSec||b.duration_sec||0).toFixed(1)}s</Td>
                <Td><code>{b.commit||''}</code></Td>
                <Td>{b.branch||''}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Card({title, children}){
  return (
    <div style={{background:'#111a2c', padding:16, border:'1px solid #23304d', borderRadius:8}}>
      <div style={{color:'#93a1b3', fontSize:12}}>{title}</div>
      {children}
    </div>
  )
}

function Th({children}){ return <th style={{textAlign:'left', padding:'8px 10px', borderBottom:'1px solid #23304d'}}>{children}</th> }
function Td({children}){ return <td style={{padding:'8px 10px'}}>{children}</td> }

function Input(props){
  return <input {...props} style={{background:'#0b1220', color:'#e6edf3', border:'1px solid #23304d', borderRadius:6, padding:'8px 10px'}} />
}

function StatusPill({ status }){
  const color = status === 'success' ? '#163d2e' : status === 'failure' ? '#4b1f24' : '#4a3c19'
  const text = status === 'success' ? '#17d47a' : status === 'failure' ? '#ff6b6b' : '#f1c40f'
  return (
    <span style={{background:color, color:text, padding:'4px 8px', borderRadius:999, fontSize:12, border:'1px solid rgba(255,255,255,0.08)'}}>
      {status || '-'}
    </span>
  )
}

function DonutChart({ value=0, size=72 }){
  const pct = Math.max(0, Math.min(100, Number(value)||0))
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}> 
      <circle cx={size/2} cy={size/2} r={r} stroke="#23304d" strokeWidth={stroke} fill="none" />
      <circle cx={size/2} cy={size/2} r={r} stroke="#17d47a" strokeWidth={stroke} fill="none" strokeDasharray={`${c} ${c}`} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
    </svg>
  )
}

function Sparkline({ data=[], width=140, height=40 }){
  const vals = (Array.isArray(data)?data:[]).filter(v=>Number.isFinite(v))
  if (vals.length === 0) return <div style={{width, height}} />
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = 2
  const W = width, H = height
  const range = Math.max(1e-6, max - min)
  const step = (W - pad*2) / Math.max(1, vals.length - 1)
  const points = vals.map((v, i) => {
    const x = pad + i * step
    const y = H - pad - ((v - min) / range) * (H - pad*2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={W} height={H}>
      <polyline points={points} fill="none" stroke="#1f6feb" strokeWidth="2" />
    </svg>
  )
}

const btnStyle = { background:'#1f6feb', color:'#fff', border:'none', borderRadius:6, padding:'8px 12px', cursor:'pointer' }
