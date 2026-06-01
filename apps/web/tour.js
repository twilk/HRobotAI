/* Guided onboarding tour (Shepherd.js). Walks the user through every function of the app. */
'use strict'
;(function () {
  const tourBtn = document.querySelector('#tourBtn')
  if (typeof window.Shepherd === 'undefined') {
    tourBtn.disabled = true
    tourBtn.title = 'Tour library failed to load (offline?)'
    return
  }

  const tour = new window.Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      scrollTo: { behavior: 'smooth', block: 'center' },
      cancelIcon: { enabled: true },
      classes: 'hrobot-step',
      modalOverlayOpeningPadding: 6,
      modalOverlayOpeningRadius: 12,
    },
  })

  const back = { text: 'Back', action: () => tour.back(), classes: 'shepherd-button-secondary' }
  const next = (text) => ({ text: text || 'Next', action: () => tour.next() })
  const step = (opts) => tour.addStep(opts)

  step({
    id: 'welcome',
    title: 'Welcome to HRobot 👋',
    text: 'This 60-second tour shows every function: claiming your URL, creating the workspace, watching it provision, signing in, viewing your team, and finishing onboarding. You can act on each step yourself as we go.',
    attachTo: { element: '[data-tour="welcome"]', on: 'bottom' },
    buttons: [{ text: 'Skip', action: () => tour.cancel(), classes: 'shepherd-button-secondary' }, next('Start')],
  })

  step({
    id: 'health',
    title: 'Live backend status',
    text: 'This pill polls <code>/api/health/ready</code> every few seconds, checking the control-plane database and Redis. Green means the API is live and the steps below will hit the real backend.',
    attachTo: { element: '[data-tour="health"]', on: 'bottom' },
    buttons: [back, next()],
  })

  step({
    id: 'slug',
    title: '1 · Claim your company URL',
    text: 'Each tenant gets an isolated workspace at <code>slug.hrobot.ai</code>. Type a slug and press <strong>Check availability</strong> — it calls <code>GET /api/slugs/check/:slug</code> (rate-limited to stop enumeration).',
    attachTo: { element: '[data-tour="slug"]', on: 'bottom' },
    beforeShowPromise: () =>
      new Promise((r) => {
        document.querySelector('#slug').focus()
        r()
      }),
    buttons: [back, next()],
  })

  step({
    id: 'signup',
    title: '2 · Create the workspace',
    text: 'Submitting calls <code>POST /api/auth/signup</code>. The control-plane returns a <code>jobId</code> (HTTP 202) and kicks off async provisioning: a dedicated Postgres database and a Keycloak identity realm, just for this company.',
    attachTo: { element: '[data-tour="signup"]', on: 'bottom' },
    buttons: [back, next()],
  })

  step({
    id: 'provisioning',
    title: '3 · Watch it provision',
    text: 'This view polls <code>/api/provision/status/:jobId</code> and lights up the state machine: <strong>Create DB → Run migrations → Seed → Keycloak setup → Done</strong>. Failures are visible, never silent.',
    attachTo: { element: '[data-tour="provisioning"]', on: 'top' },
    buttons: [back, next()],
  })

  step({
    id: 'login',
    title: '4 · Sign in',
    text: 'Platform operators sign in via <code>POST /api/auth/global/login</code> (bcrypt). Tenant employees sign in through their company\'s Keycloak realm, which mints a JWT carrying their <code>hrobot_roles</code>.',
    attachTo: { element: '[data-tour="login"]', on: 'top' },
    buttons: [back, next()],
  })

  step({
    id: 'team',
    title: '5 · Your team',
    text: 'The directory calls <code>GET /api/employees</code> on the tenant-runtime. It is tenant-scoped and RBAC-guarded, and <strong>PESEL national IDs are never sent to the browser</strong> — privacy by construction (RODO).',
    attachTo: { element: '[data-tour="team"]', on: 'top' },
    buttons: [back, next()],
  })

  step({
    id: 'checklist',
    title: '6 · Finish onboarding',
    text: 'Track setup tasks here. Saving calls <code>PATCH /tenants/me/onboarding-checklist</code> and requires the tenant-admin (ADMIN_KLIENTA) role — every mutation is audited automatically.',
    attachTo: { element: '[data-tour="checklist"]', on: 'top' },
    buttons: [back, next()],
  })

  step({
    id: 'done',
    title: 'That\'s the whole product 🎉',
    text: 'You have seen every function HRobot exposes today: URL claim, signup, provisioning, sign-in, team directory, and onboarding. Re-run the tour any time from the top-right.',
    attachTo: { element: '[data-tour="checklist"]', on: 'top' },
    buttons: [back, { text: 'Finish', action: () => tour.complete() }],
  })

  tourBtn.addEventListener('click', () => {
    if (tour.isActive()) return
    tour.start()
  })

  // Auto-start once per browser so a fresh visitor lands straight in the tour.
  try {
    if (!localStorage.getItem('hrobot_tour_seen')) {
      localStorage.setItem('hrobot_tour_seen', '1')
      setTimeout(() => tour.start(), 600)
    }
  } catch {
    /* localStorage blocked — tour still available via the button */
  }
})()
