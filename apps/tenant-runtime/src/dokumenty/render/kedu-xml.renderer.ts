/**
 * `dokumenty` KEDU-XML renderer — PURE, no Prisma/I/O (SPEC §4.2 / DOK-9). Takes the already-computed
 * {@link KeduModel} (produced by `kedu.util.ts`) and serializes it into a structural KEDU XML
 * document. This module does NOT compute anything — it only formats what the engine already decided.
 *
 * Hard safety requirement (SPEC §0 / §4.2): the XML KEDU carries PESEL (a formal requirement of the
 * format). The renderer never fetches/decrypts it — it is already present on the model, handed in by
 * the caller (service layer, controlled + audited — SPEC §6). To make it impossible to mistake this
 * output for a filing-ready document, every render carries:
 *  - a header XML comment flagging the file as DEMO / not for ZUS submission, and
 *  - a `<demo>true</demo>` element inside the document body.
 *
 * The XML shape (DRA/RCA/RSA) is a POGLĄDOWA structural skeleton — validated structurally, not
 * semantically, on demo (🔴 DECYZJA-4M for the real KEDU 5.x schema — SPEC §3.4/§4.2).
 */

import type { KeduModel, KeduRcaBlock, KeduRsaBlock } from '../kedu.util'

/** Escape the five XML predefined entities so free-text fields (imię/nazwisko) can't break the markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function tag(name: string, value: string | number): string {
  return `<${name}>${typeof value === 'number' ? value : escapeXml(value)}</${name}>`
}

function renderRca(b: KeduRcaBlock): string {
  return [
    '    <pozycja>',
    `      ${tag('employeeId', b.employeeId)}`,
    `      ${tag('pesel', b.pesel)}`,
    `      ${tag('imie', b.imie)}`,
    `      ${tag('nazwisko', b.nazwisko)}`,
    `      ${tag('workedMinutes', b.workedMinutes)}`,
    `      ${tag('ot50Min', b.ot50Min)}`,
    `      ${tag('ot100Min', b.ot100Min)}`,
    '    </pozycja>',
  ].join('\n')
}

function renderRsa(b: KeduRsaBlock): string {
  return [
    '    <pozycja>',
    `      ${tag('employeeId', b.employeeId)}`,
    `      ${tag('pesel', b.pesel)}`,
    `      ${tag('category', b.category)}`,
    `      ${tag('kod', b.kod)}`,
    `      ${tag('od', b.od)}`,
    `      ${tag('do', b.do)}`,
    '    </pozycja>',
  ].join('\n')
}

/**
 * Serialize a {@link KeduModel} into a structural KEDU XML string. Pure function — string in
 * (well, model in), string out; no Prisma, no filesystem, no network. SPEC §4.2 / DOK-9.
 */
export function renderKeduXml(model: KeduModel): string {
  const dra = model.dra
  const draBlock = [
    '  <DRA>',
    `    ${tag('platnikNip', dra.platnikNip)}`,
    `    ${tag('platnikNazwa', dra.platnikNazwa)}`,
    `    ${tag('kodTerminu', dra.kodTerminu)}`,
    `    ${tag('okresOd', dra.okresOd)}`,
    `    ${tag('okresDo', dra.okresDo)}`,
    `    ${tag('liczbaUbezpieczonych', dra.liczbaUbezpieczonych)}`,
    '  </DRA>',
  ].join('\n')

  const rcaBlock = model.rca.length > 0 ? ['  <RCA>', ...model.rca.map(renderRca), '  </RCA>'].join('\n') : '  <RCA></RCA>'

  const rsaBlock = model.rsa.length > 0 ? ['  <RSA>', ...model.rsa.map(renderRsa), '  </RSA>'].join('\n') : '  <RSA></RSA>'

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- WERSJA POGLĄDOWA DEMO — dane syntetyczne — NIE DO WYSYŁKI ZUS. Wygenerowano przez HRobot/4Mobility (demo). -->',
    '<KEDU>',
    `  ${tag('demo', 'true')}`,
    `  ${tag('wersjaSchematu', model.wersjaSchematu)}`,
    draBlock,
    rcaBlock,
    rsaBlock,
    '</KEDU>',
    '',
  ].join('\n')
}
