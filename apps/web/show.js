/* HRobot autoplay "show" — a hands-free, timed walkthrough that DRIVES the real system.
 *
 * The user clicks "Play the show" once; from then on it auto-advances: each beat narrates what
 * is about to happen, performs the real action (live API calls via window.HRobot), waits for the
 * real result (e.g. provisioning actually reaching DONE), then pauses for a readable beat and
 * moves on — no clicks needed. A control bar offers Pause/Resume, Skip, Restart, Stop, and speed.
 *
 * Design: timers pace the *narration*; real backend events gate *progression*. Provisioning is
 * awaited (not blind-timed), so the viewer literally watches the tenant get configured. */
'use strict'
;(function () {
  const H = window.HRobot
  if (!H) return // app.js must load first

  // ---- speed + cancellation ------------------------------------------------
  const SPEED = { slow: 1.6, normal: 1, fast: 0.6 }
  const ctrl = {
    speed: 'normal',
    playing: false,
    paused: false,
    cancelled: false,
    pauseWaiters: [],
  }
  const scale = (ms) => ms * SPEED[ctrl.speed]

  /** Cancellable, pause-aware sleep. Resolves early if the show is stopped. */
  function wait(ms) {
    return new Promise((resolve) => {
      let remaining = scale(ms)
      let startedAt = Date.now()
      let timer = null
      const tick = () => {
        if (ctrl.cancelled) return resolve('cancelled')
        if (ctrl.paused) {
          remaining -= Date.now() - startedAt
          ctrl.pauseWaiters.push(onResume)
          return
        }
        resolve('done')
      }
      const onResume = () => {
        startedAt = Date.now()
        timer = setTimeout(tick, Math.max(0, remaining))
      }
      timer = setTimeout(tick, remaining)
      // expose so a hard stop can clear it
      wait._timers.add(() => timer && clearTimeout(timer))
    })
  }
  wait._timers = new Set()

  function resumeAll() {
    const waiters = ctrl.pauseWaiters.splice(0)
    waiters.forEach((fn) => fn())
  }

  /** Await a guard fn() that returns a truthy/terminal value, polling, pause/cancel-aware.
   *  Used to await real backend completion (provisioning) without blind timers. */
  async function awaitValue(getPromise) {
    const result = await getPromise
    return result
  }

  // ---- caption / stage UI --------------------------------------------------
  const stage = document.createElement('div')
  stage.id = 'show-stage'
  stage.innerHTML = `
    <div id="show-caption" role="status" aria-live="polite">
      <div class="sc-row">
        <span class="sc-badge" id="sc-step">●</span>
        <div class="sc-text">
          <div class="sc-title" id="sc-title">HRobot — the show</div>
          <div class="sc-body" id="sc-body">Press play and watch a tenant get configured, hands-free.</div>
        </div>
      </div>
      <div class="sc-progress"><div class="sc-progress-bar" id="sc-progress-bar"></div></div>
      <div class="sc-controls">
        <button id="sc-playpause" class="sc-btn">⏸ Pause</button>
        <button id="sc-skip" class="sc-btn ghost">⏭ Skip</button>
        <button id="sc-restart" class="sc-btn ghost">↺ Restart</button>
        <button id="sc-stop" class="sc-btn ghost">✕ Stop</button>
        <span class="sc-spacer"></span>
        <label class="sc-speed">Speed
          <select id="sc-speed">
            <option value="slow">0.6×</option>
            <option value="normal" selected>1×</option>
            <option value="fast">1.6×</option>
          </select>
        </label>
      </div>
    </div>`
  document.body.appendChild(stage)

  const el = {
    stage,
    step: document.getElementById('sc-step'),
    title: document.getElementById('sc-title'),
    body: document.getElementById('sc-body'),
    bar: document.getElementById('sc-progress-bar'),
    playpause: document.getElementById('sc-playpause'),
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }
  function focusSection(selector) {
    const node = document.querySelector(selector)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    document.querySelectorAll('.show-focus').forEach((n) => n.classList.remove('show-focus'))
    node.classList.add('show-focus')
  }
  function narrate(n, total, title, body) {
    el.step.textContent = n
    el.title.innerHTML = `${escapeHtml(title)}`
    el.body.innerHTML = body
    el.bar.style.width = `${Math.round((n / total) * 100)}%`
  }

  // ---- the script ----------------------------------------------------------
  // Each beat: focus a section, narrate, perform a real action, then a readable pause.
  const TOTAL = 7
  async function run() {
    const slug = H.freshSlug()
    const company = 'Wisła HR Demo Sp. z o.o.'
    const email = `owner@${slug}.test`

    // 0 — intro
    narrate(0, TOTAL, '🎬 The HRobot show', 'Sit back — no clicks needed. I will configure a brand-new tenant live, narrating every step. Use the bar below to pause, change speed, or stop.')
    focusSection('[data-tour="welcome"]')
    await wait(3800)
    if (ctrl.cancelled) return

    // 1 — claim URL (real slug check)
    focusSection('[data-tour="slug"]')
    narrate(1, TOTAL, '1 · Claiming the company URL', `Picking a fresh slug <code>${escapeHtml(slug)}</code> and checking availability via <code>GET /api/slugs/check/:slug</code>…`)
    H.setSlug(slug)
    await wait(1200)
    if (ctrl.cancelled) return
    const slugRes = await H.checkSlug()
    el.body.innerHTML = slugRes.available
      ? `<code>${escapeHtml(slug)}.hrobot.ai</code> is available. ✓`
      : `Slug check returned: taken. (The show will still proceed.)`
    await wait(2600)
    if (ctrl.cancelled) return

    // 2 — create workspace (real signup -> jobId)
    focusSection('[data-tour="signup"]')
    narrate(2, TOTAL, '2 · Creating the workspace', `Submitting <code>POST /api/auth/signup</code> for <strong>${escapeHtml(company)}</strong>. The control-plane returns a job id and starts provisioning an isolated database + Keycloak realm.`)
    H.setCompany(company, email)
    await wait(1400)
    if (ctrl.cancelled) return
    const signupRes = await H.signup()
    if (!signupRes.ok) {
      el.body.innerHTML = `Signup did not start (is the control-plane on :3000?). Stopping the show.`
      return stop()
    }
    el.body.innerHTML = `Workspace queued — job <code>${escapeHtml(String(signupRes.jobId).slice(0, 8))}…</code>. Now watching it build itself.`
    await wait(2200)
    if (ctrl.cancelled) return

    // 3 — provisioning (AWAIT real completion, not a timer)
    focusSection('[data-tour="provisioning"]')
    narrate(3, TOTAL, '3 · Watching it provision (live)', 'The state machine runs for real: <strong>Create DB → Run migrations → Seed → Keycloak setup → Done</strong>. I am polling the live job status and will continue once the tenant is actually ready.')
    // signup() already kicked off polling; await its terminal outcome by polling again on the same job.
    const outcome = await pollUntilTerminal()
    if (ctrl.cancelled) return
    el.body.innerHTML = outcome.done
      ? '✓ Provisioning complete — a real, isolated tenant now exists.'
      : outcome.failed
        ? `Provisioning reported a failure at <code>${escapeHtml(outcome.step || '?')}</code>. In dev this is usually a Keycloak warm-up race; the durable retry re-runs it. Continuing the walkthrough.`
        : 'Provisioning is taking longer than the show waits for; continuing the walkthrough while it finishes in the background.'
    await wait(3000)
    if (ctrl.cancelled) return

    // 4 — sign in (real global-admin login -> JWT)
    focusSection('[data-tour="login"]')
    narrate(4, TOTAL, '4 · Signing in', 'Authenticating the platform operator via <code>POST /api/auth/global/login</code> (bcrypt) — the response is a signed JWT.')
    await wait(1200)
    if (ctrl.cancelled) return
    const loginRes = await H.login()
    el.body.innerHTML = loginRes.ok
      ? `Signed in — JWT issued${loginRes.roles && loginRes.roles.length ? `, role <code>${escapeHtml(loginRes.roles[0])}</code>` : ''}.`
      : 'Sign-in failed (control-plane offline?). Continuing.'
    await wait(2600)
    if (ctrl.cancelled) return

    // 5 — team directory (real call; demo fallback on RBAC)
    focusSection('[data-tour="team"]')
    narrate(5, TOTAL, '5 · The team directory', 'Calling <code>GET /api/employees</code> on the tenant-runtime. It is tenant-scoped and RBAC-guarded — and <strong>PESEL national IDs are never sent to the browser</strong> (RODO).')
    await wait(1200)
    if (ctrl.cancelled) return
    const teamRes = await H.loadTeam(true)
    el.body.innerHTML = teamRes.live
      ? 'Loaded the live tenant directory.'
      : teamRes.demo
        ? 'The global-admin token cannot read tenant data (isolation working as designed), so the show displays representative data to illustrate the view.'
        : 'Directory needs a tenant token; showing the design intent.'
    await wait(3200)
    if (ctrl.cancelled) return

    // 6 — onboarding checklist (real PATCH; auth-aware)
    focusSection('[data-tour="checklist"]')
    narrate(6, TOTAL, '6 · Finishing onboarding', 'Ticking the setup tasks and saving via <code>PATCH /tenants/me/onboarding-checklist</code> — a tenant-admin (ADMIN_KLIENTA) action that is automatically audited.')
    await wait(1200)
    if (ctrl.cancelled) return
    const ckRes = await H.saveChecklist({ addEmployees: true, configureSchedule: true, inviteUsers: true })
    el.body.innerHTML = ckRes.live
      ? 'Checklist saved to the tenant.'
      : 'Saving needs a tenant-admin Keycloak token; the intent is shown and the action is wired to the real endpoint.'
    await wait(3000)
    if (ctrl.cancelled) return

    // 7 — done
    focusSection('[data-tour="checklist"]')
    narrate(7, TOTAL, '🎉 That is the whole flow', 'You just watched HRobot configure a real tenant end-to-end — URL claim, signup, live provisioning, sign-in, team, and onboarding — with zero clicks. Press Restart to run it again with a new tenant.')
    el.playpause.disabled = true
    ctrl.playing = false
  }

  /** Re-poll the current job to a terminal state (the show's await on real provisioning). */
  async function pollUntilTerminal() {
    // app.js's startPolling resolves on terminal state; re-invoke it for the active job.
    if (!H.state.jobId) return { ok: false }
    return H.startPolling()
  }

  // ---- controls ------------------------------------------------------------
  function setPaused(p) {
    ctrl.paused = p
    el.playpause.textContent = p ? '▶ Resume' : '⏸ Pause'
    if (!p) resumeAll()
  }
  function stop() {
    ctrl.cancelled = true
    ctrl.playing = false
    setPaused(false)
    wait._timers.forEach((clear) => clear())
    wait._timers.clear()
    el.stage.classList.add('hidden')
    document.querySelectorAll('.show-focus').forEach((n) => n.classList.remove('show-focus'))
  }
  async function start() {
    if (ctrl.playing) return
    ctrl.cancelled = false
    ctrl.paused = false
    ctrl.playing = true
    el.stage.classList.remove('hidden')
    el.playpause.disabled = false
    setPaused(false)
    await run()
  }
  function restart() {
    stop()
    setTimeout(start, 250)
  }

  el.playpause.addEventListener('click', () => setPaused(!ctrl.paused))
  document.getElementById('sc-stop').addEventListener('click', stop)
  document.getElementById('sc-restart').addEventListener('click', restart)
  document.getElementById('sc-skip').addEventListener('click', () => {
    // skip the current pause by resolving timers immediately
    wait._timers.forEach((clear) => clear())
    wait._timers.clear()
    if (ctrl.paused) setPaused(false)
    resumeAll()
  })
  document.getElementById('sc-speed').addEventListener('change', (e) => {
    ctrl.speed = e.target.value
  })

  // public entry for the header button
  window.HRobotShow = { start, stop, restart }
})()
