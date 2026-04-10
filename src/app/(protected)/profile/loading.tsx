export default function ProfileLoading() {
  return (
    <div className="px-4 pt-6 pb-28 animate-pulse">
      {/* Header skeleton */}
      <div className="h-7 w-24 bg-gray-200 rounded-lg mb-6" />

      {/* User card */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-gray-200 rounded-full" />
          <div>
            <div className="h-4 w-28 bg-gray-200 rounded mb-1" />
            <div className="h-3 w-40 bg-gray-100 rounded" />
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between mb-1">
            <div className="h-3 w-28 bg-gray-100 rounded" />
            <div className="h-3 w-16 bg-gray-100 rounded" />
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="text-center">
              <div className="h-6 w-10 bg-gray-200 rounded mx-auto mb-1" />
              <div className="h-3 w-14 bg-gray-100 rounded mx-auto" />
            </div>
          ))}
        </div>
      </div>

      {/* Phone section */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
        <div className="h-10 bg-gray-100 rounded-lg" />
      </div>

      {/* Contact & logout */}
      <div className="h-12 bg-white rounded-xl shadow-sm mb-4" />
      <div className="h-12 bg-gray-100 rounded-xl" />
    </div>
  )
}
