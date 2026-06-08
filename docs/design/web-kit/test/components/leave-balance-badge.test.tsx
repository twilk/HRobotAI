import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeaveBalanceBadge } from '@/components/wnioski/leave-balance-badge'

describe('LeaveBalanceBadge', () => {
  it('shows "X dni" text', () => {
    render(<LeaveBalanceBadge remaining={10} leaveType="urlop_wypoczynkowy" />)
    expect(screen.getByText(/10 dni/i)).toBeInTheDocument()
  })

  it('shows green badge when remaining > 7', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={8} leaveType="urlop_wypoczynkowy" />,
    )
    const badge = container.querySelector('[data-tone="green"]')
    expect(badge).toBeInTheDocument()
  })

  it('shows amber badge when remaining is between 3 and 7 inclusive', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={5} leaveType="urlop_wypoczynkowy" />,
    )
    const badge = container.querySelector('[data-tone="amber"]')
    expect(badge).toBeInTheDocument()
  })

  it('shows amber badge when remaining is exactly 3', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={3} leaveType="urlop_wypoczynkowy" />,
    )
    const badge = container.querySelector('[data-tone="amber"]')
    expect(badge).toBeInTheDocument()
  })

  it('shows amber badge when remaining is exactly 7', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={7} leaveType="urlop_wypoczynkowy" />,
    )
    const badge = container.querySelector('[data-tone="amber"]')
    expect(badge).toBeInTheDocument()
  })

  it('shows red badge when remaining < 3', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={2} leaveType="urlop_wypoczynkowy" />,
    )
    const badge = container.querySelector('[data-tone="red"]')
    expect(badge).toBeInTheDocument()
  })

  it('shows red badge when remaining is 0', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={0} leaveType="urlop_wypoczynkowy" />,
    )
    const badge = container.querySelector('[data-tone="red"]')
    expect(badge).toBeInTheDocument()
  })

  it('renders label when provided', () => {
    render(
      <LeaveBalanceBadge remaining={10} leaveType="urlop_wypoczynkowy" label="Urlop wypoczynkowy" />,
    )
    expect(screen.getByText(/Urlop wypoczynkowy/i)).toBeInTheDocument()
  })

  it('renders without label (label is optional)', () => {
    const { container } = render(
      <LeaveBalanceBadge remaining={10} leaveType="urlop_wypoczynkowy" />,
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
