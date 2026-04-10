export default function AlbumLoading() {
  return (
    <div className="px-4 pt-6 pb-28 animate-pulse">
      {/* Header skeleton */}
      <div className="h-7 w-32 bg-gray-200 rounded-lg mb-1" />
      <div className="h-4 w-48 bg-gray-100 rounded mb-5" />

      {/* Stats cards */}
      <div className="flex gap-2 mb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex-1 bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gray-100" />
              <div>
                <div className="h-5 w-8 bg-gray-200 rounded mb-1" />
                <div className="h-2.5 w-14 bg-gray-100 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Export banner skeleton */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-xl">
        <div className="w-9 h-9 rounded-lg bg-gray-200" />
        <div className="flex-1">
          <div className="h-4 w-24 bg-gray-200 rounded mb-1" />
          <div className="h-3 w-48 bg-gray-100 rounded" />
        </div>
      </div>

      {/* Search bar skeleton */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 h-10 bg-gray-100 rounded-xl" />
        <div className="w-10 h-10 bg-gray-100 rounded-xl" />
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
        {['Todas', 'Faltam', 'Repetidas'].map((t) => (
          <div key={t} className="flex-1 py-2 text-center text-[11px] font-semibold text-gray-300 rounded-lg">
            {t}
          </div>
        ))}
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-2">
            <div className="h-3 w-10 bg-gray-100 rounded mx-auto mb-1.5" />
            <div className="h-2 w-14 bg-gray-50 rounded mx-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
