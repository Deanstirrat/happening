import type { Metadata } from "next";
import FeatureRequestForm from "@/components/submit/FeatureRequestForm";

export const metadata: Metadata = {
  title: "Feature Your Event — happening",
  description: "Get your SF event featured on happening and reach thousands of local explorers.",
};

export default function FeaturePage() {
  return (
    <div className="max-w-screen-sm mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <div className="mb-10">
        <h1 className="font-headline font-black text-4xl sm:text-5xl text-on-surface lowercase leading-none mb-3">
          feature your event
        </h1>
        <p className="font-body text-on-surface-variant text-sm leading-relaxed">
          Want your event pinned at the top of the happening explore page? Reach out — we hand-pick
          events we love and work with organizers to make sure the right people find them.
        </p>
      </div>

      <FeatureRequestForm />
    </div>
  );
}
