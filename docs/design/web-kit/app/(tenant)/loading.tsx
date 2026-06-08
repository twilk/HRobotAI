export default function TenantLoading() {
  return (
    <div role="status" aria-label="Ładowanie…" className="flex min-h-screen">
      <aside className="hidden w-[220px] border-r border-line bg-card md:block">
        <div className="p-4 space-y-3">
          <div className="h-8 w-24 rounded bg-line animate-pulse" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded bg-line/60 animate-pulse" />
          ))}
        </div>
      </aside>
      <main className="flex-1 p-6 space-y-4">
        <div className="h-8 w-48 rounded bg-line animate-pulse" />
        <div className="h-4 w-64 rounded bg-line/60 animate-pulse" />
        <div className="mt-6 rounded-lg border border-line bg-card h-48 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-line bg-card animate-pulse" />
          ))}
        </div>
      </main>
    </div>
  )
}
