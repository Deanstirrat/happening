import SubmitWizard from "@/components/submit/SubmitWizard";

export const metadata = {
  title: "Submit an Event — happening",
  description: "Know about an underground SF event? Submit it and we'll add it to the calendar.",
};

interface Props {
  searchParams: Promise<{ fromFeature?: string }>;
}

export default async function SubmitPage({ searchParams }: Props) {
  const { fromFeature } = await searchParams;
  const isFromFeature = fromFeature === "true";

  return (
    <div className="max-w-screen-sm mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="font-headline font-black text-4xl sm:text-5xl text-on-surface lowercase leading-none">
          add to the pulse
        </h1>
        <p className="font-body text-on-surface-variant text-sm mt-3 max-w-md">
          Upload a flyer, paste an event link, or fill in the details yourself.
        </p>
      </div>
      {isFromFeature && (
        <div className="bg-surface-container rounded-xl px-4 py-3 mb-6">
          <p className="font-body text-sm text-on-surface">
            submitting a new event for featuring? fill in the details below and we&apos;ll
            review it for the spotlight.
          </p>
        </div>
      )}
      <SubmitWizard fromFeature={isFromFeature} />
    </div>
  );
}
