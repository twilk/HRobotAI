import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '@/components/ui/modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Test">Content</Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders with role=dialog when open', () => {
    render(<Modal open onClose={() => {}} title="Test Modal">Content</Modal>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('calls onClose when scrim is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(<Modal open onClose={onClose} title="Test">Content</Modal>)
    // The scrim is the first child of the portal root (aria-hidden div)
    const scrim = container.firstChild as HTMLElement
    await user.click(scrim)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('places role="dialog" on the card element, not the scrim', () => {
    render(<Modal open title="Test" onClose={() => {}}>content</Modal>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
  })

  it('h2 title element has id="modal-title"', () => {
    render(<Modal open title="Test Title" onClose={() => {}}>content</Modal>)
    expect(document.getElementById('modal-title')?.textContent).toBe('Test Title')
  })
})
