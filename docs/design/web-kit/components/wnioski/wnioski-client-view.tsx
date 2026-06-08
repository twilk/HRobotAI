'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Table, Th, Td } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { IconRequests, IconPlus } from '@/components/icons'
import { getEmployees } from '@/lib/employees'
import {
  updateLeaveRequest,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from '@/lib/wnioski'
import {
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
} from '@/lib/actions/wnioski-actions'

type TabValue = 'all' | LeaveStatus

const TABS: { value: TabValue; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'pending', label: 'Oczekujące' },
  { value: 'approved', label: 'Zatwierdzone' },
  { value: 'rejected', label: 'Odrzucone' },
]

function statusTone(status: LeaveStatus): 'warn' | 'ok' | 'default' | 'muted' {
  switch (status) {
    case 'pending':   return 'warn'
    case 'approved':  return 'ok'
    case 'rejected':  return 'default'
    case 'cancelled': return 'muted'
  }
}

interface AddFormState {
  employeeId: string
  type: LeaveType
  dateFrom: string
  dateTo: string
  days: string
  reason: string
}

const EMPTY_FORM: AddFormState = {
  employeeId: '',
  type: 'urlop-wypoczynkowy',
  dateFrom: '',
  dateTo: '',
  days: '',
  reason: '',
}

export function WnioskiClientView({ initialRequests }: { initialRequests: LeaveRequest[] }) {
  const [requests, setRequests] = useState<LeaveRequest[]>(initialRequests)
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const employees = getEmployees()

  const filtered =
    activeTab === 'all'
      ? requests
      : requests.filter((r) => r.status === activeTab)

  function handleApprove(id: string) {
    // Optimistic local update
    const updated = updateLeaveRequest(id, {
      status: 'approved',
      approvedBy: 'Admin',
      approvedAt: new Date().toISOString(),
    })
    if (updated) {
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)))
    }
    // Persist via server action (fire-and-forget; optimistic state already applied)
    void approveLeaveRequest(id, 'manager@hrobot.ai')
  }

  function openReject(id: string) {
    setRejectId(id)
    setRejectReason('')
    setShowReject(true)
  }

  function handleReject() {
    if (!rejectId) return
    // Optimistic local update
    const updated = updateLeaveRequest(rejectId, {
      status: 'rejected',
      rejectionReason: rejectReason,
    })
    if (updated) {
      setRequests((prev) => prev.map((r) => (r.id === rejectId ? updated : r)))
    }
    // Persist via server action
    void rejectLeaveRequest(rejectId, 'manager@hrobot.ai', rejectReason)
    setShowReject(false)
    setRejectId(null)
  }

  function handleAddSubmit() {
    if (!form.employeeId) { setFormError('Wybierz pracownika'); return }
    if (!form.type) { setFormError('Wybierz typ urlopu'); return }
    if (!form.dateFrom) { setFormError('Podaj datę od'); return }
    if (!form.dateTo) { setFormError('Podaj datę do'); return }
    if (!form.days || Number(form.days) < 1) { setFormError('Podaj liczbę dni'); return }

    const employee = employees.find((e) => e.id === form.employeeId)
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : form.employeeId

    const newRequest: LeaveRequest = {
      id: `wr-${Date.now()}`,
      employeeId: form.employeeId,
      employeeName,
      type: form.type,
      status: 'pending',
      dateFrom: form.dateFrom,
      dateTo: form.dateTo,
      days: Number(form.days),
      reason: form.reason || undefined,
      requestedAt: new Date().toISOString(),
    }

    // Optimistic local update
    setRequests((prev) => [newRequest, ...prev])
    // Persist via server action (fire-and-forget)
    void createLeaveRequest({
      employeeId: form.employeeId,
      employeeName,
      type: form.type,
      dateFrom: form.dateFrom,
      dateTo: form.dateTo,
      days: Number(form.days),
      reason: form.reason || undefined,
    })
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowAdd(false)
  }

  return (
    <div className="max-w-[1120px] mx-auto">
      {/* Header */}
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Wnioski
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {filtered.length !== requests.length
              ? `${filtered.length} z ${requests.length} wniosków`
              : `${requests.length} wniosków`}
          </p>
        </div>
        <Button className="h-10 px-3.5 text-sm" onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowAdd(true) }}>
          <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
          Złóż wniosek
        </Button>
      </div>

      {/* Filter tabs */}
      <div role="tablist" className="flex gap-1 mb-5 border-b border-line pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-t-sm border-b-2 -mb-px transition-colors',
              activeTab === tab.value
                ? 'border-accent text-accent-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <EmptyState icon={IconRequests} title="Brak wniosków">
          Brak wniosków spełniających wybrane kryteria.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Pracownik</Th>
              <Th>Typ</Th>
              <Th>Okres</Th>
              <Th>Dni</Th>
              <Th>Status</Th>
              <Th>Akcje</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((req) => (
              <tr key={req.id}>
                <Td className="font-medium text-navy">{req.employeeName}</Td>
                <Td>{LEAVE_TYPE_LABELS[req.type]}</Td>
                <Td className="text-muted whitespace-nowrap">
                  {req.dateFrom} – {req.dateTo}
                </Td>
                <Td className="text-center">{req.days}</Td>
                <Td>
                  <Badge tone={statusTone(req.status)}>
                    {LEAVE_STATUS_LABELS[req.status]}
                  </Badge>
                </Td>
                <Td>
                  {req.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => handleApprove(req.id)}
                      >
                        Zatwierdź
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-7 px-2.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                        onClick={() => openReject(req.id)}
                      >
                        Odrzuć
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Add leave request modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Złóż wniosek urlopowy"
        className="max-w-[520px]"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="wr-employee" className="block text-sm font-medium text-ink mb-1.5">
              Pracownik
            </label>
            <select
              id="wr-employee"
              aria-label="Pracownik"
              value={form.employeeId}
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
              className="w-full h-10 px-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            >
              <option value="">— wybierz pracownika —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wr-type" className="block text-sm font-medium text-ink mb-1.5">
              Typ urlopu
            </label>
            <select
              id="wr-type"
              aria-label="Typ urlopu"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LeaveType }))}
              className="w-full h-10 px-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            >
              {(Object.entries(LEAVE_TYPE_LABELS) as [LeaveType, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="wr-date-from" className="block text-sm font-medium text-ink mb-1.5">
                Data od
              </label>
              <input
                id="wr-date-from"
                aria-label="Data od"
                type="date"
                value={form.dateFrom}
                onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
                className="w-full h-10 px-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="wr-date-to" className="block text-sm font-medium text-ink mb-1.5">
                Data do
              </label>
              <input
                id="wr-date-to"
                aria-label="Data do"
                type="date"
                value={form.dateTo}
                onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
                className="w-full h-10 px-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label htmlFor="wr-days" className="block text-sm font-medium text-ink mb-1.5">
              Liczba dni
            </label>
            <input
              id="wr-days"
              aria-label="Liczba dni"
              type="number"
              min={1}
              value={form.days}
              onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}
              className="w-full h-10 px-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="wr-reason" className="block text-sm font-medium text-ink mb-1.5">
              Powód <span className="text-muted font-normal">(opcjonalnie)</span>
            </label>
            <textarea
              id="wr-reason"
              aria-label="Powód"
              rows={3}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="w-full px-3 py-2 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-1">
            <Button variant="ghost" className="h-9 px-4 text-sm" onClick={() => setShowAdd(false)}>
              Anuluj
            </Button>
            <Button className="h-9 px-4 text-sm" onClick={handleAddSubmit}>
              Złóż wniosek
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject reason modal */}
      <Modal
        open={showReject}
        onClose={() => setShowReject(false)}
        title="Odrzuć wniosek"
        className="max-w-[440px]"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="wr-reject-reason" className="block text-sm font-medium text-ink mb-1.5">
              Powód odrzucenia
            </label>
            <textarea
              id="wr-reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-1">
            <Button variant="ghost" className="h-9 px-4 text-sm" onClick={() => setShowReject(false)}>
              Anuluj
            </Button>
            <Button className="h-9 px-4 text-sm" onClick={handleReject}>
              Odrzuć wniosek
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
