/* HRobot onboarding app — drives the live control-plane (/api) and tenant-runtime (/tapi) APIs.
 * Each function step is exposed on window.HRobot so the autoplay "show" (show.js) can drive the
 * exact same real actions hands-free and await their real completion. */
'use strict'
const $ = (sel) => document.querySelector(sel)
const PROV_STEPS = ['CREATE_DB', 'RUN_MIGRATIONS', 'SEED', 'KEYCLOAK_SETUP', 'DONE']

const state = { jobId: null, token: null, slug: 'acme', pollTimer: null, lastStep: null }

/** fetch + JSON with uniform result shape; never throws. The bearer token is attached only to
 *  tenant-runtime (/tapi) calls — the control-plane endpoints don't need it. */
async function call(path, opts = {}) {
  const wantAuth = path.startsWith('/tapi')
  try {
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(state.token && wantAuth ? { authorization: `Bearer ${state.token}` } : {}),
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function set(id, html, cls) {
  const el = $(id)
  el.innerHTML = html
  el.className = 'out' + (cls ? ' ' + cls : '')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
function setSlug(slug) {
  state.slug = slug.trim()
  const input = $('#slug')
  if (input) input.value = state.slug
  $('#slugPreview').textContent = state.slug || 'your-company'
}
async function checkSlug() {
  const slug = state.slug
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) {
    set('#slugOut', 'Use 3–30 lowercase letters, numbers and dashes.', 'warn')
    return { ok: false }
  }
  set('#slugOut', 'Checking…', 'muted')
  const r = await call(`/api/slugs/check/${encodeURIComponent(slug)}`)
  if (!r.ok) {
    set('#slugOut', `Could not check (${r.status}). Is the API running?`, 'err')
    return { ok: false }
  }
  set(
    '#slugOut',
    r.data.available
      ? `✓ <strong>${escapeHtml(slug)}.hrobot.ai</strong> is available.`
      : `✗ <strong>${escapeHtml(slug)}</strong> is taken — try another.`,
    r.data.available ? 'ok' : 'err',
  )
  return { ok: true, available: !!r.data.available }
}
$('#slug').addEventListener('input', (e) => setSlug(e.target.value))
$('#slugBtn').addEventListener('click', () => checkSlug())

/* ---- 2. signup ---- */
async function signup() {
  const body = JSON.stringify({
    companyName: $('#company').value.trim(),
    slug: state.slug,
    adminEmail: $('#email').value.trim(),
  })
  set('#signupOut', 'Creating workspace…', 'muted')
  const r = await call('/api/auth/signup', { method: 'POST', body })
  if (!r.ok || !r.data?.jobId) {
    const msg = r.data?.message || r.data?.detail || `HTTP ${r.status}`
    set('#signupOut', `Signup failed: ${escapeHtml(String(msg))}`, 'err')
    return { ok: false }
  }
  state.jobId = r.data.jobId
  set('#signupOut', `✓ Workspace queued. Job <code>${escapeHtml(r.data.jobId)}</code> — watch provisioning below.`, 'ok')
  // Hold the polling promise so callers (the show) can await THIS session's terminal outcome
  // instead of starting a second competing poller for the same job.
  state.pollPromise = startPolling()
  return { ok: true, jobId: r.data.jobId, provisioning: state.pollPromise }
}
$('#signupBtn').addEventListener('click', () => signup())

/* ---- 3. provisioning ---- */
function renderSteps(current, failed) {
  const idx = PROV_STEPS.indexOf(current)
  document.querySelectorAll('#steps .step').forEach((el) => {
    const i = PROV_STEPS.indexOf(el.dataset.step)
    el.classList.remove('active', 'done', 'failed')
    if (failed && i === idx) el.classList.add('failed')
    else if (failed && i < idx) el.classList.add('done')
    else if (current === 'DONE') el.classList.add('done')
    else if (!failed && i < idx) el.classList.add('done')
    else if (!failed && i === idx) el.classList.add('active')
  })
}
/** Poll the provisioning job. Returns a promise that resolves with the terminal outcome
 *  ({done}|{failed}|{timedOut}) so the show can await real provisioning completion. */
function startPolling() {
  if (!state.jobId) return Promise.resolve({ ok: false })
  if (state.pollTimer) clearInterval(state.pollTimer)
  const myJob = state.jobId // capture this polling session's job id (guards against races)
  state.lastStep = null
  let polls = 0
  let errors = 0
  return new Promise((resolve) => {
    let timer = null // this session's own interval handle — finish() must never clear a newer one
    const finish = (outcome) => {
      if (timer) clearInterval(timer)
      if (state.pollTimer === timer) state.pollTimer = null
      resolve(outcome)
    }
    const tick = async () => {
      if (state.jobId !== myJob) return finish({ ok: false, superseded: true })
      polls += 1
      const r = await call(`/api/provision/status/${encodeURIComponent(myJob)}`)
      if (state.jobId !== myJob) return finish({ ok: false, superseded: true })
      if (!r.ok) {
        errors += 1
        if (errors >= 5 || polls >= 60) {
          set('#provOut', `Stopped polling — status checks failing (${r.status || 'network'}).`, 'err')
          return finish({ ok: false })
        }
        return set('#provOut', `Status check failed (${r.status || 'network'}); retrying…`, 'warn')
      }
      errors = 0
      const { step, attemptCount, done, failed, errorCode } = r.data
      if (PROV_STEPS.includes(step)) state.lastStep = step
      const shownStep = failed ? state.lastStep || step : step
      renderSteps(shownStep, failed)
      // Check `failed` BEFORE `done`: a failed job must never render as success.
      if (failed) {
        const where = shownStep && shownStep !== 'FAILED' ? ` at <code>${escapeHtml(shownStep)}</code>` : ''
        set('#provOut', `✗ Provisioning failed${where}${errorCode ? ' — ' + escapeHtml(String(errorCode)) : ''}.`, 'err')
        return finish({ ok: false, failed: true, step: shownStep })
      } else if (done) {
        set('#provOut', `✓ Provisioning complete — tenant is ready.`, 'ok')
        return finish({ ok: true, done: true })
      } else {
        set(
          '#provOut',
          `Working… current step <code>${escapeHtml(String(step))}</code> (attempt ${Number(attemptCount) || 0}).` +
            (step === 'KEYCLOAK_SETUP'
              ? ' <span class="muted">Keycloak realm setup can pause in dev until the admin client is configured.</span>'
              : ''),
          'muted',
        )
        if (polls >= 60) {
          set('#provOut', `Still at <code>${escapeHtml(String(step))}</code> after ${polls} checks — stopped polling.`, 'warn')
          return finish({ ok: false, timedOut: true, step })
        }
      }
    }
    tick()
    timer = setInterval(tick, 1500)
    state.pollTimer = timer
  })
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
async function login() {
  set('#loginOut', 'Signing in…', 'muted')
  const r = await call('/api/auth/global/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('#loginEmail').value.trim(), password: $('#loginPass').value }),
  })
  if (!r.ok || !r.data?.accessToken) {
    set('#loginOut', `Sign-in failed (${r.status}).`, 'err')
    return { ok: false }
  }
  state.token = r.data.accessToken
  const claims = decodeJwt(state.token)
  const roles = Array.isArray(claims?.roles) ? claims.roles : Array.isArray(claims?.hrobot_roles) ? claims.hrobot_roles : []
  set(
    '#loginOut',
    `✓ Signed in. Token issued${roles.length ? `, roles: ${roles.map(escapeHtml).join(', ')}` : ''}.` +
      ` <span class="muted">JWT <code>${escapeHtml(state.token.slice(0, 24))}…</code></span>`,
    'ok',
  )
  return { ok: true, roles }
}
$('#loginBtn').addEventListener('click', () => login())

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
/** loadTeam(demoOnAuthFail): in the show, fall back to demo data automatically so the
 *  function is still demonstrated even without a tenant Keycloak token. */
async function loadTeam(demoOnAuthFail) {
  set('#teamOut', 'Loading…', 'muted')
  const r = await call('/tapi/employees')
  if (r.ok && Array.isArray(r.data)) {
    renderEmployees(r.data, false)
    return { ok: true, live: true }
  }
  if (r.status === 401 || r.status === 403) {
    if (demoOnAuthFail) {
      renderEmployees(DEMO_EMPLOYEES, true)
      return { ok: true, demo: true }
    }
    $('#teamOut').className = 'out'
    $('#teamOut').innerHTML =
      `<div class="note">The directory is tenant-scoped: it needs a tenant employee's Keycloak token ` +
      `(the global-admin token can't read tenant data — that's the isolation working). ` +
      `<button id="demoTeam" class="ghost" style="margin-top:8px">Show demo data</button></div>`
    $('#demoTeam').addEventListener('click', () => renderEmployees(DEMO_EMPLOYEES, true))
    return { ok: false, authRequired: true }
  }
  set('#teamOut', `Could not load (${r.status}). Is the tenant-runtime API on :3001?`, 'err')
  return { ok: false }
}
$('#teamBtn').addEventListener('click', () => loadTeam(false))

/* ---- 6. checklist ---- */
async function saveChecklist(values) {
  if (values) {
    $('#ck-addEmployees').checked = !!values.addEmployees
    $('#ck-configureSchedule').checked = !!values.configureSchedule
    $('#ck-inviteUsers').checked = !!values.inviteUsers
  }
  const payload = {
    addEmployees: $('#ck-addEmployees').checked,
    configureSchedule: $('#ck-configureSchedule').checked,
    inviteUsers: $('#ck-inviteUsers').checked,
  }
  set('#checklistOut', 'Saving…', 'muted')
  const r = await call('/tapi/tenants/me/onboarding-checklist', { method: 'PATCH', body: JSON.stringify(payload) })
  if (r.ok) {
    set('#checklistOut', `✓ Saved: ${escapeHtml(JSON.stringify(r.data))}`, 'ok')
    return { ok: true, live: true }
  }
  if (r.status === 401 || r.status === 403) {
    set(
      '#checklistOut',
      'Saving needs the tenant-admin (ADMIN_KLIENTA) role via a Keycloak token. The form is captured locally for the tour.',
      'warn',
    )
    return { ok: true, authRequired: true }
  }
  set('#checklistOut', `Could not save (${r.status}).`, 'err')
  return { ok: false }
}
$('#checklistBtn').addEventListener('click', () => saveChecklist())

/* A fresh, valid slug so the show provisions a brand-new tenant each run.
 * Deterministic-ish from the clock; matches ^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$. */
function freshSlug() {
  const n = Date.now().toString(36).slice(-6)
  return `demo-${n}`
}

refreshHealth()
setInterval(refreshHealth, 10000)

/* Expose the real step actions + helpers for the autoplay show (show.js). */
window.HRobot = {
  state,
  sleep,
  freshSlug,
  setSlug,
  checkSlug,
  setCompany: (name, email) => {
    if (name) $('#company').value = name
    if (email) $('#email').value = email
  },
  signup,
  awaitProvisioning: () => state.pollPromise || Promise.resolve({ ok: false }),
  startPolling,
  login,
  loadTeam,
  saveChecklist,
  PROV_STEPS,
}
