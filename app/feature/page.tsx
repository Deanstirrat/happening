import type { Metadata } from "next";
import FeatureRequestForm from "@/components/submit/FeatureRequestForm";

export const metadata: Metadata = {
  title: "Feature an Event — happening",
  description: "Suggest an SF event to be featured on happening and reach thousands of local explorers.",
};

export default function FeaturePage() {
  return (
    <div className="max-w-screen-sm mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <div className="mb-10">
        <h1 className="font-headline font-black text-4xl sm:text-5xl text-on-surface lowercase leading-none mb-3">
          feature an event
        </h1>
        <p className="font-body text-on-surface-variant text-sm leading-relaxed">
          Know an event that deserves the spotlight? Search for it below, suggest any details we
          might be missing, and we&apos;ll consider featuring it at the top of the explore page.
        </p>
      </div>

      <FeatureRequestForm />
    </div>
  );
}
