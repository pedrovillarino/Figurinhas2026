export default function ScanLoading() {
  return (
    <div className="px-4 pt-6 pb-28 animate-pulse">
      {/* Header skeleton */}
      <div className="h-7 w-48 bg-gray-200 rounded-lg mb-1" />
      <div className="h-4 w-64 bg-gray-100 rounded mb-6" />

      {/* Camera placeholder */}
      <div className="aspect-[3/4] bg-gray-100 rounded-2xl mb-6 flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-gray-200" />
      </div>

      {/* Action button placeholder */}
      <div className="h-12 bg-gray-200 rounded-xl" />
    </div>
  )
}
