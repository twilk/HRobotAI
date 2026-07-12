#!/usr/bin/env node
// Rebuilds the `hrobot-staging` demo realm in Keycloak from scratch — idempotent.
//
// WHY THIS EXISTS: the dev Keycloak runs `start-dev` with an H2 store that only persists if a
// volume is mounted. The demo realm + demo users were created once at runtime and were NOT in a
// mounted volume, so any `docker compose down` wiped them. This script re-seeds the exact realm the
// tenant-runtime + web-kit expect, so the demo can always be restored deterministically.
//
// CRITICAL: the demo users are created with FIXED ids that the tenant DB (`hrobot_t_900d948b`,
// tenant slug=staging) already references via `users.keycloak_sub`. The grafik "employee sees own
// shifts" query matches `employee.user.keycloakSub === jwt.sub`, so these ids MUST match or Anna's
// schedule would come back empty.
//
// Realm shape mirrors apps/control-plane/src/provisioning/steps/keycloak-setup.step.ts:
//   realm hrobot-<slug>, all Role enum values as realm roles, public client `hrobot-web` with the
//   `hrobot-realm-roles` mapper projecting realm roles into the multivalued `hrobot_roles` claim.
// Difference: we also enable directAccessGrantsEnabled (the web-kit login uses the password grant).

const KC = process.env.KC_URL || 'http://localhost:8081'
const ADMIN_USER = process.env.KC_ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.KC_ADMIN_PASS || 'admin'
const REALM = 'hrobot-staging'
const ROLES = ['PRACOWNIK', 'MANAGER', 'HR', 'ADMIN_KLIENTA']

// Fixed ids come from `SELECT id, email, keycloak_sub FROM users` in hrobot_t_900d948b.
const USERS = [
  { username: 'demo', email: 'admin@staging.hrobot.local', password: 'demo-staging-2026', role: 'ADMIN_KLIENTA', firstName: 'Demo', lastName: 'Admin' },
  { expectSub: 'a1912c35-776b-419b-b992-fe7ef1a45edb', username: 'pracownik.demo', email: 'pracownik.demo@demo.hrobot.local', password: 'Pracownik!2026', role: 'PRACOWNIK', firstName: 'Anna', lastName: 'Kowalska' },
  { expectSub: '8f5c2877-2e1c-4675-9118-a108e96558b5', username: 'manager.demo', email: 'manager.demo@demo.hrobot.local', password: 'Manager!2026', role: 'MANAGER', firstName: 'Marek', lastName: 'Manager' },
]

async function adminToken() {
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASS }),
  })
  if (!r.ok) throw new Error(`admin token ${r.status}: ${await r.text()}`)
  return (await r.json()).access_token
}

async function main() {
  const token = await adminToken()
  const base = `${KC}/admin/realms`
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  // tolerate 409 (already exists) so the whole script is safe to re-run
  const kc = async (url, init) => {
    const r = await fetch(url, init)
    if (!r.ok && r.status !== 409) throw new Error(`${init.method || 'GET'} ${url} -> ${r.status}: ${await r.text()}`)
    return r
  }

  // 1. realm. frontendUrl pins the token `iss` to the compose-internal Keycloak host so tokens
  //    minted via the host (localhost:8081) still validate inside the tenant-runtime container:
  //    KeycloakJwtStrategy.isTrustedIssuer requires iss to start with KEYCLOAK_URL (http://keycloak:8080)
  //    and then fetches JWKS from that same iss — which only resolves over the compose network.
  await kc(base, { method: 'POST', headers: H, body: JSON.stringify({ realm: REALM, enabled: true, accessTokenLifespan: 300, ssoSessionMaxLifespan: 36000, attributes: { frontendUrl: 'http://keycloak:8080' } }) })
  // PUT the attribute explicitly too — on a re-run the POST above 409s and would not update it.
  await kc(`${base}/${REALM}`, { method: 'PUT', headers: H, body: JSON.stringify({ attributes: { frontendUrl: 'http://keycloak:8080' } }) })
  console.log(`realm ${REALM} (frontendUrl=http://keycloak:8080) ✓`)

  // 2. realm roles
  for (const name of ROLES) {
    await kc(`${base}/${REALM}/roles`, { method: 'POST', headers: H, body: JSON.stringify({ name }) })
  }
  console.log(`roles ${ROLES.join(', ')} ✓`)

  // 3. hrobot-web public client + hrobot_roles mapper + direct grant
  await kc(`${base}/${REALM}/clients`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      clientId: 'hrobot-web',
      publicClient: true,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: true,
      redirectUris: ['*'],
      webOrigins: ['*'],
      protocolMappers: [{
        name: 'hrobot-realm-roles',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-usermodel-realm-role-mapper',
        config: {
          'claim.name': 'hrobot_roles',
          'jsonType.label': 'String',
          multivalued: 'true',
          'access.token.claim': 'true',
          'id.token.claim': 'false',
          'userinfo.token.claim': 'false',
          'usermodel.realmRoleMapping.rolePrefix': '',
        },
      }],
    }),
  })
  console.log(`client hrobot-web (direct grant + hrobot_roles mapper) ✓`)

  // 4. users + non-temporary passwords + realm-role mapping.
  //    Keycloak IGNORES a client-supplied `id` on POST /users, so we let it assign one, then read
  //    it back. `expectSub` records the id the tenant DB currently references so the caller can
  //    reconcile `users.keycloak_sub` to the real Keycloak id (see the SYNC block printed below).
  const syncPairs = []
  for (const u of USERS) {
    // requiredActions:[] + emailVerified prevent Keycloak's "Account is not fully set up" (which
    // blocks the direct-grant password flow). firstName/lastName satisfy realm profile requirements.
    const userBody = {
      username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName,
      enabled: true, emailVerified: true, requiredActions: [],
      credentials: [{ type: 'password', value: u.password, temporary: false }],
    }
    await kc(`${base}/${REALM}/users`, { method: 'POST', headers: H, body: JSON.stringify(userBody) })
    // resolve the real Keycloak id by username (create may have 409'd on re-run)
    const lk = await kc(`${base}/${REALM}/users?username=${encodeURIComponent(u.username)}&exact=true`, { method: 'GET', headers: H })
    const userId = (await lk.json())[0]?.id
    if (!userId) throw new Error(`could not resolve id for ${u.username}`)

    // PUT ensures an EXISTING user (409 above) also gets requiredActions cleared + profile set.
    await kc(`${base}/${REALM}/users/${userId}`, { method: 'PUT', headers: H, body: JSON.stringify({ firstName: u.firstName, lastName: u.lastName, emailVerified: true, enabled: true, requiredActions: [] }) })
    await kc(`${base}/${REALM}/users/${userId}/reset-password`, { method: 'PUT', headers: H, body: JSON.stringify({ type: 'password', value: u.password, temporary: false }) })
    const rr = await kc(`${base}/${REALM}/roles/${u.role}`, { method: 'GET', headers: H })
    const role = await rr.json()
    await kc(`${base}/${REALM}/users/${userId}/role-mappings/realm`, { method: 'POST', headers: H, body: JSON.stringify([{ id: role.id, name: role.name }]) })
    console.log(`user ${u.username} (${u.role}) id=${userId} ✓`)
    if (u.expectSub && u.expectSub !== userId) syncPairs.push({ email: u.email, from: u.expectSub, to: userId })
  }

  console.log('\nDONE — realm hrobot-staging rebuilt. Logins: demo/demo-staging-2026, pracownik.demo/Pracownik!2026, manager.demo/Manager!2026')
  if (syncPairs.length) {
    console.log('\n-- SYNC tenant DB users.keycloak_sub to the real Keycloak ids:')
    for (const p of syncPairs) {
      console.log(`UPDATE users SET keycloak_sub='${p.to}' WHERE email='${p.email}'; -- was ${p.from}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
