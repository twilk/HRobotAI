'use server'
import { addLeaveRequest, updateLeaveRequest, getLeaveRequests, getLeaveRequest, type LeaveType } from '@/lib/wnioski'
import { deductEmployeeLeave } from '@/lib/actions/leave-balance-actions'
import { addNotification } from '@/lib/notifications'

interface CreateLeaveRequestData {
  employeeId: string
  employeeName: string
  type: LeaveType
  dateFrom: string
  dateTo: string
  days: number
  reason?: string
}

export async function createLeaveRequest(
  data: CreateLeaveRequestData,
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!data.employeeId) {
    return { success: false, error: 'employeeId is required' }
  }
  if (!data.type) {
    return { success: false, error: 'type is required' }
  }
  if (!data.dateFrom) {
    return { success: false, error: 'dateFrom is required' }
  }
  if (!data.dateTo) {
    return { success: false, error: 'dateTo is required' }
  }
  if (!data.days || data.days < 1) {
    return { success: false, error: 'days must be at least 1' }
  }

  const req = addLeaveRequest({
    employeeId: data.employeeId,
    employeeName: data.employeeName,
    type: data.type,
    dateFrom: data.dateFrom,
    dateTo: data.dateTo,
    days: data.days,
    ...(data.reason !== undefined ? { reason: data.reason } : {}),
  })

  return { success: true, id: req.id }
}

export async function approveLeaveRequest(
  id: string,
  approvedBy: string,
): Promise<{ success: boolean; error?: string }> {
  // Fetch request before updating so we know the employee + type + days
  const req = getLeaveRequest(id)
  if (!req) {
    return { success: false, error: `Leave request '${id}' not found` }
  }

  const updated = updateLeaveRequest(id, {
    status: 'approved',
    approvedBy,
    approvedAt: new Date().toISOString(),
  })
  if (!updated) {
    return { success: false, error: `Leave request '${id}' not found` }
  }

  // Auto-deduct the days from the employee's leave balance when trackable type
  await deductEmployeeLeave(req.employeeId, req.type, req.days)

  addNotification({
    type: 'leave-approved',
    priority: 'high',
    title: 'Wniosek zatwierdzony',
    message: `Wniosek urlopowy pracownika ${req.employeeName ?? ''} został zatwierdzony.`,
    employeeId: req.employeeId,
    employeeName: req.employeeName,
    actionUrl: '/wnioski',
  })

  return { success: true }
}

export async function rejectLeaveRequest(
  id: string,
  approvedBy: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const req = getLeaveRequest(id)
  const updated = updateLeaveRequest(id, {
    status: 'rejected',
    rejectionReason: reason,
  })
  if (!updated) {
    return { success: false, error: `Leave request '${id}' not found` }
  }

  addNotification({
    type: 'leave-rejected',
    priority: 'high',
    title: 'Wniosek odrzucony',
    message: `Wniosek urlopowy pracownika ${req?.employeeName ?? ''} został odrzucony.`,
    employeeId: req?.employeeId,
    employeeName: req?.employeeName,
    actionUrl: '/wnioski',
  })

  return { success: true }
}

export async function cancelLeaveRequest(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const updated = updateLeaveRequest(id, { status: 'cancelled' })
  if (!updated) {
    return { success: false, error: `Leave request '${id}' not found` }
  }
  return { success: true }
}
