'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmployeesTable } from './employees-table'
import { EmployeesEmpty } from './employees-empty'
import { AddEmployeeModal } from './add-employee-modal'
import { IconPlus, IconSearch } from '@/components/icons'
import type { Employee, EmployeeDetail } from '@/lib/employees'

function matchesQuery(e: Employee, q: string): boolean {
  const s = q.toLowerCase()
  return (
    e.firstName.toLowerCase().includes(s) ||
    e.lastName.toLowerCase().includes(s) ||
    e.email.toLowerCase().includes(s) ||
    e.position.toLowerCase().includes(s)
  )
}

export function PracownicyClientView({ initialEmployees }: { initialEmployees: Employee[] }) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const filtered = query ? employees.filter((e) => matchesQuery(e, query)) : employees

  function handleAdd(emp: Employee) {
    // Cast to EmployeeDetail for the list (detail fields are optional in real API).
    setEmployees((prev) => [
      ...prev,
      {
        ...emp,
        phone: '',
        address: '',
        birthYear: '',
        hireDate: new Date().toISOString().slice(0, 10),
        contractType: emp.contract === 'UoP' ? 'Czas nieokreślony' : emp.contract === 'Zlecenie' ? 'Umowa zlecenie' : 'Kontrakt B2B',
        fte: 'Pełny etat · 1,0',
        manager: '',
        salaryMasked: '•• ••• PLN',
        region: 'EU-CENTRAL',
        realm: 'hrobot-acme',
        audit: [{ ts: new Date().toISOString().slice(0, 16).replace('T', ' '), action: 'Utworzono profil', actor: 'Admin' }],
      } as EmployeeDetail,
    ])
  }

  if (employees.length === 0 && !query) {
    return (
      <>
        <EmployeesEmpty />
        <AddEmployeeModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
      </>
    )
  }

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Pracownicy</h1>
          <p className="text-muted text-sm mt-1.5 whitespace-nowrap">
            {filtered.length !== employees.length
              ? `${filtered.length} z ${employees.length} osób`
              : `${employees.length} osób · 2 jednostki organizacyjne`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative hidden sm:block" data-guide="pracownicy:search">
            <IconSearch className="absolute left-[11px] top-[11px] w-[17px] h-[17px] text-muted-2" strokeWidth={1.7} />
            <label htmlFor="emp-search" className="sr-only">Szukaj pracownika</label>
            <input
              id="emp-search"
              role="searchbox"
              placeholder="Szukaj pracownika"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-[230px] pl-[35px] pr-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            />
          </div>
          <Button className="h-10 px-3.5 text-sm" onClick={() => setShowAdd(true)} data-guide="pracownicy:add-employee">
            <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
            Dodaj pracownika
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-muted">
          <p className="font-medium">Brak wyników dla &bdquo;{query}&rdquo;</p>
          <button onClick={() => setQuery('')} className="mt-2 text-sm text-accent-ink hover:underline">Wyczyść filtr</button>
        </div>
      ) : (
        <EmployeesTable employees={filtered} />
      )}

      <AddEmployeeModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
    </div>
  )
}
