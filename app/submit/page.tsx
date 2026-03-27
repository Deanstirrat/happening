import QuickSubmit from "@/components/submit/QuickSubmit";
import SubmitForm from "@/components/submit/SubmitForm";

export const metadata = {
  title: "Submit an Event — happening",
  description: "Know about an underground SF event? Submit it and we'll add it to the calendar.",
};

export default function SubmitPage() {
  return (
    <div className="max-w-screen-sm mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-12">
      {/* Quick submit */}
      <div>
        <div className="mb-6">
          <h1 className="font-headline font-black text-4xl sm:text-5xl text-on-surface lowercase leading-none">
            submit an event
          </h1>
          <p className="font-body text-on-surface-variant text-sm mt-3 max-w-md">
            Saw a flyer? Snap a photo and we'll handle the rest.
          </p>
        </div>
        <QuickSubmit />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4" id="full-form">
        <div className="flex-1 h-px bg-on-surface/10" />
        <span className="font-body text-xs text-on-surface-variant uppercase tracking-widest">
          or fill it in yourself
        </span>
        <div className="flex-1 h-px bg-on-surface/10" />
      </div>

      {/* Full form */}
      <div>
        <p className="font-body text-on-surface-variant text-sm mb-6 max-w-md">
          Paste an Instagram caption, event description, or enter details manually. All submissions are reviewed before going live.
        </p>
        <SubmitForm />
      </div>
    </div>
  );
}
