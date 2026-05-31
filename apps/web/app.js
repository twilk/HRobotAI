/* HRobot onboarding app — drives the live control-plane (/api) and tenant-runtime (/tapi) APIs. */
'use strict'
const $ = (sel) => document.querySelector(sel)
const PROV_STEPS = ['CREATE_DB', 'RUN_MIGRATIONS', 'SEED', 'KEYCLOAK_SETUP', 'DONE']

const state = { jobId: null, token: null, slug: 'acme', pollTimer: null }

/** fetch + JSON with uniform result shape; never throws. */
async function call(path, opts = {}) {
  try {
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
        ...(opts.headers || {}),
      },
    })
    let data = null
    const text = await res.text()
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'network', detail: String(err) } }
  }
}

function set(id, html, cls) {
  const el = $(id)
  el.innerHTML = html
  el.className = 'out' + (cls ? ' ' + cls : '')
}

/* ---- health pill ---- */
async function refreshHealth() {
  const el = $('#health')
  const r = await call('/api/health/ready')
  if (r.ok) {
    el.textContent = 'API: live'
    el.className = 'pill up'
  } else if (r.status === 0 || r.status === 502) {
    el.textContent = 'API: offline'
    el.className = 'pill down'
  } else {
    el.textContent = `API: degraded (${r.status})`
    el.className = 'pill down'
  }
}

/* ---- 1. slug ---- */
$('#slug').addEventListener('input', (e) => {
  state.slug = e.target.value.trim()
  $('#slugPreview').textContent = state.slug || 'your-company'
})
$('#slugBtn').addEventListener('click', async () => {
  const slug = state.slug
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) {
    return set('#slugOut', 'Use 3–30 lowercase letters, numbers and dashes.', 'warn')
  }
  set('#slugOut', 'Checking…', 'muted')
  const r = await call(`/api/slugs/check/${encodeURIComponent(slug)}`)
  if (!r.ok) return set('#slugOut', `Could not check (${r.status}). Is the API running?`, 'err')
  set(
    '#slugOut',
    r.data.available
      ? `✓ <strong>${slug}.hrobot.ai</strong> is available.`
      : `✗ <strong>${slug}</strong> is taken — try another.`,
    r.data.available ? 'ok' : 'err',
  )
})

/* ---- 2. signup ---- */
$('#signupBtn').addEventListener('click', async () => {
  const body = JSON.stringify({
    companyName: $('#company').value.trim(),
    slug: state.slug,
    adminEmail: $('#email').value.trim(),
  })
  set('#signupOut', 'Creating workspace…', 'muted')
  const r = await call('/api/auth/signup', { method: 'POST', body })
  if (!r.ok || !r.data?.jobId) {
    const msg = r.data?.message || r.data?.detail || `HTTP ${r.status}`
    return set('#signupOut', `Signup failed: ${escapeHtml(String(msg))}`, 'err')
  }
  state.jobId = r.data.jobId
  set('#signupOut', `✓ Workspace queued. Job <code>${r.data.jobId}</code> — watch provisioning below.`, 'ok')
  startPolling()
})

/* ---- 3. provisioning ---- */
function renderSteps(current, failed) {
  const idx = PROV_STEPS.indexOf(current)
  document.querySelectorAll('#steps .step').forEach((el) => {
    const i = PROV_STEPS.indexOf(el.dataset.step)
    el.classList.remove('active', 'done', 'failed')
    if (failed && i === idx) el.classList.add('failed')
    else if (current === 'DONE') el.classList.add('done')
    else if (i < idx) el.classList.add('done')
    else if (i === idx) el.classList.add('active')
  })
}
function startPolling() {
  if (!state.jobId) return
  if (state.pollTimer) clearInterval(state.pollTimer)
  let polls = 0
  const tick = async () => {
    polls += 1
    const r = await call(`/api/provision/status/${state.jobId}`)
    if (!r.ok) {
      set('#provOut', `Status check failed (${r.status}).`, 'err')
      return
    }
    const { step, attemptCount, done, failed, errorCode } = r.data
    renderSteps(step, failed)
    if (done) {
      clearInterval(state.pollTimer)
      set('#provOut', `✓ Provisioning complete — tenant is ready.`, 'ok')
    } else if (failed) {
      clearInterval(state.pollTimer)
      set('#provOut', `✗ Failed at <code>${step}</code>${errorCode ? ' — ' + escapeHtml(errorCode) : ''}.`, 'err')
    } else {
      set(
        '#provOut',
        `Working… current step <code>${step}</code> (attempt ${attemptCount ?? 0}).` +
          (step === 'KEYCLOAK_SETUP'
            ? ' <span class="muted">Keycloak realm setup can pause in dev until the admin client is configured.</span>'
            : ''),
        'muted',
      )
      if (polls >= 40) {
        clearInterval(state.pollTimer)
        set('#provOut', `Still at <code>${step}</code> after ${polls} checks — stopped polling. Re-track to resume.`, 'warn')
      }
    }
  }
  tick()
  state.pollTimer = setInterval(tick, 1500)
}
$('#trackLink').addEventListener('click', (e) => {
  e.preventDefault()
  const id = prompt('Provisioning job id:')
  if (id) {
    state.jobId = id.trim()
    startPolling()
  }
})

/* ---- 4. login ---- */
function decodeJwt(token) {
  try {
    const p = token.split('.')[1]
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}
$('#loginBtn').addEventListener('click', async () => {
  set('#loginOut', 'Signing in…', 'muted')
  const r = await call('/api/auth/global/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('#loginEmail').value.trim(), password: $('#loginPass').value }),
  })
  if (!r.ok || !r.data?.accessToken) {
    return set('#loginOut', `Sign-in failed (${r.status}).`, 'err')
  }
  state.token = r.data.accessToken
  const claims = decodeJwt(state.token)
  const roles = claims?.roles || claims?.hrobot_roles || []
  set(
    '#loginOut',
    `✓ Signed in. Token issued${roles.length ? `, roles: ${roles.map(escapeHtml).join(', ')}` : ''}.` +
      ` <span class="muted">JWT <code>${state.token.slice(0, 24)}…</code></span>`,
    'ok',
  )
})

/* ---- 5. team ---- */
const DEMO_EMPLOYEES = [
  { firstName: 'Anna', lastName: 'Kowalska', position: 'HR Manager', employmentType: 'UMOWA_O_PRACE', hiredAt: '2024-02-01' },
  { firstName: 'Piotr', lastName: 'Nowak', position: 'Engineer', employmentType: 'B2B', hiredAt: '2024-06-15' },
  { firstName: 'Maria', lastName: 'Wiśniewska', position: 'Accountant', employmentType: 'UMOWA_ZLECENIE', hiredAt: '2025-01-10' },
]
function renderEmployees(rows, demo) {
  if (!rows.length) return set('#teamOut', 'No employees yet.', 'muted')
  const body = rows
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.firstName)} ${escapeHtml(e.lastName)}</td><td>${escapeHtml(e.position ?? '')}</td>` +
        `<td>${escapeHtml(e.employmentType ?? '')}</td><td>${escapeHtml(String(e.hiredAt ?? '').slice(0, 10))}</td></tr>`,
    )
    .join('')
  $('#teamOut').className = 'out'
  $('#teamOut').innerHTML =
    (demo ? '<div class="note">Showing demo data — a live list needs a tenant employee signed in via Keycloak.</div>' : '') +
    `<table><thead><tr><th>Name</th><th>Position</th><th>Contract</th><th>Hired</th></tr></thead><tbody>${body}</tbody></table>`
}
$('#teamBtn').addEventListener('click', async () => {
  set('#teamOut', 'Loading…', 'muted')
  const r = await call('/tapi/employees')
  if (r.ok && Array.isArray(r.data)) return renderEmployees(r.data, false)
  if (r.status === 401 || r.status === 403) {
    $('#teamOut').className = 'out'
    $('#teamOut').innerHTML =
      `<div class="note">The directory is tenant-scoped: it needs a tenant employee's Keycloak token ` +
      `(the global-admin token can't read tenant data — that's the isolation working). ` +
      `<button id="demoTeam" class="ghost" style="margin-top:8px">Show demo data</button></div>`
    $('#demoTeam').addEventListener('click', () => renderEmployees(DEMO_EMPLOYEES, true))
    return
  }
  set('#teamOut', `Could not load (${r.status}). Is the tenant-runtime API on :3001?`, 'err')
})

/* ---- 6. checklist ---- */
$('#checklistBtn').addEventListener('click', async () => {
  const payload = {
    addEmployees: $('#ck-addEmployees').checked,
    configureSchedule: $('#ck-configureSchedule').checked,
    inviteUsers: $('#ck-inviteUsers').checked,
  }
  set('#checklistOut', 'Saving…', 'muted')
  const r = await call('/tapi/tenants/me/onboarding-checklist', { method: 'PATCH', body: JSON.stringify(payload) })
  if (r.ok) {
    return set('#checklistOut', `✓ Saved: ${escapeHtml(JSON.stringify(r.data))}`, 'ok')
  }
  if (r.status === 401 || r.status === 403) {
    return set(
      '#checklistOut',
      'Saving needs the tenant-admin (ADMIN_KLIENTA) role via a Keycloak token. The form is captured locally for the tour.',
      'warn',
    )
  }
  set('#checklistOut', `Could not save (${r.status}).`, 'err')
})

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

refreshHealth()
setInterval(refreshHealth, 10000)
