/**
 * Instant skeleton for the homepage: mirrors hero → sidebar → carousel → card
 * grid so the page appears composed while events stream in.
 */
export default function Loading() {
  return (
    <div aria-busy aria-label="Loading events">
      {/* Hero band */}
      <div className="relative min-h-[24rem] h-[48vh] max-h-[34rem] flex items-end">
        <div className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 pb-10 sm:pb-14">
          <div className="skeleton h-3 w-40 rounded-full mb-4" />
          <div className="skeleton h-16 sm:h-20 w-[min(36rem,85%)] rounded-2xl" />
          <div className="skeleton h-4 w-56 rounded-full mt-6" />
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 pb-8 flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Sidebar */}
        <div className="hidden lg:flex w-52 shrink-0 flex-col gap-3">
          <div className="skeleton h-8 rounded-full" />
          <div className="skeleton h-8 rounded-full" />
          <div className="skeleton h-8 rounded-full" />
          <div className="skeleton h-28 rounded-DEFAULT mt-2" />
        </div>

        {/* Main column */}
        <div className="flex-1 min-w-0">
          <div className="skeleton h-5 w-40 rounded-full mb-3" />
          <div className="skeleton aspect-[16/9] rounded-lg mb-8" />

          <div className="flex gap-2 mb-8">
            <div className="skeleton h-7 w-20 rounded-full" />
            <div className="skeleton h-7 w-20 rounded-full" />
            <div className="skeleton h-7 w-20 rounded-full" />
            <div className="skeleton h-7 w-20 rounded-full" />
          </div>

          <div className="skeleton h-7 w-32 rounded-full mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-DEFAULT overflow-hidden edge">
                <div className="skeleton aspect-[4/3]" />
                <div className="p-3 flex flex-col gap-2">
                  <div className="skeleton h-3.5 w-5/6 rounded-full" />
                  <div className="skeleton h-3 w-3/5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
