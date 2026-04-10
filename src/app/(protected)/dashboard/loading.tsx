export default function DashboardLoading() {
  return (
    <div className="px-4 pt-6 pb-28 animate-pulse">
      {/* Header skeleton */}
      <div className="h-7 w-40 bg-gray-200 rounded-lg mb-1" />
      <div className="h-4 w-56 bg-gray-100 rounded mb-6" />

      {/* Progress ring placeholder */}
      <div className="flex justify-center mb-6">
        <div className="w-36 h-36 rounded-full bg-gray-100" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl p-3 border border-gray-100">
            <div className="h-6 w-10 bg-gray-200 rounded mb-1 mx-auto" />
            <div className="h-3 w-14 bg-gray-100 rounded mx-auto" />
          </div>
        ))}
      </div>

      {/* Chart placeholders */}
      {[1, 2].map((i) => (
        <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 mb-4">
          <div className="h-5 w-32 bg-gray-200 rounded mb-3" />
          <div className="h-40 bg-gray-50 rounded-lg" />
        </div>
      ))}
    </div>
  )
}
