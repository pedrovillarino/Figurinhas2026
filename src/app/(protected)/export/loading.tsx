export default function ExportLoading() {
  return (
    <div className="px-4 pt-6 pb-28 animate-pulse">
      {/* Header skeleton */}
      <div className="h-7 w-36 bg-gray-200 rounded-lg mb-1" />
      <div className="h-4 w-52 bg-gray-100 rounded mb-6" />

      {/* Export options */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 mb-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100" />
          <div className="flex-1">
            <div className="h-4 w-28 bg-gray-200 rounded mb-1" />
            <div className="h-3 w-44 bg-gray-100 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
