#!/usr/bin/env bash
# Parity smoke: sprawdza trasy per rola + kluczowe flow. Uruchamiany PRZED migracją
# przeciw web-kit (BASE=http://localhost:5601) i PO migracji przeciw Caddy (BASE=http://localhost:8080).
# Użycie: BASE=http://localhost:5601 KC=http://localhost:8081 bash scripts/parity-smoke.sh
set -uo pipefail
BASE=${BASE:-http://localhost:5601}
KC=${KC:-http://localhost:8081}
FAIL=0
say(){ printf '%-52s %s\n' "$1" "$2"; }
chk(){ local name="$1" got="$2" exp="$3"; if [ "$got" = "$exp" ]; then say "$name" "OK ($got)"; else say "$name" "FAIL (got=$got exp=$exp)"; FAIL=1; fi; }
mint(){ curl -s "$KC/realms/hrobot-staging/protocol/openid-connect/token" -d "grant_type=password&client_id=hrobot-web&username=$1&password=$2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).access_token||"")}catch(e){}})'; }

echo "== trasy publiczne =="
chk "GET /login"  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/login)" 200
echo "== trasy tenantowe (bez sesji → 200 render lub 307 redirect; NIE 404/500) =="
for p in dashboard grafik pracownicy wnioski dostepy zamiany analiza dokumenty asystent ustawienia; do
  code=$(curl -s -o /dev/null -w '%{http_code}' $BASE/$p)
  case "$code" in 200|307|308) say "GET /$p" "OK ($code)";; *) say "GET /$p" "FAIL ($code)"; FAIL=1;; esac
done
echo "== login 3 role (ROPC) =="
for u in "demo:demo-staging-2026" "manager.demo:Manager!2026" "pracownik.demo:Pracownik!2026"; do
  n=${u%%:*}; p=${u##*:}; t=$(mint "$n" "$p"); [ ${#t} -gt 100 ] && say "token $n" "OK" || { say "token $n" "FAIL"; FAIL=1; }
done
echo ""
[ "$FAIL" = 0 ] && { echo "PARITY: GREEN"; exit 0; } || { echo "PARITY: RED"; exit 1; }
