export default function TradesLoading() {
  return (
    <div className="px-4 pt-6 pb-28 animate-pulse">
      {/* Header skeleton */}
      <div className="h-7 w-32 bg-gray-200 rounded-lg mb-1" />
      <div className="h-4 w-56 bg-gray-100 rounded mb-6" />

      {/* Location banner */}
      <div className="bg-gray-50 rounded-xl p-4 mb-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-200" />
        <div className="flex-1">
          <div className="h-4 w-36 bg-gray-200 rounded mb-1" />
          <div className="h-3 w-24 bg-gray-100 rounded" />
        </div>
      </div>

      {/* Match cards */}
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 mb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gray-200" />
            <div className="flex-1">
              <div className="h-4 w-24 bg-gray-200 rounded mb-1" />
              <div className="h-3 w-16 bg-gray-100 rounded" />
            </div>
            <div className="h-6 w-16 bg-gray-100 rounded-full" />
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="h-6 w-12 bg-gray-50 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
