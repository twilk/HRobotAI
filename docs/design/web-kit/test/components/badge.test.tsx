import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'

describe('Badge', () => {
  it('renders children with the requested tone', () => {
    render(<Badge tone="ok">Aktywny</Badge>)
    const el = screen.getByText('Aktywny')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('text-verified')
  })

  it('defaults to the muted/default tone', () => {
    render(<Badge>UoP</Badge>)
    expect(screen.getByText('UoP')).toHaveClass('text-muted')
  })
})
