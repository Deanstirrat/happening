import type { Metadata } from "next";
import SavedEventsList from "@/components/events/SavedEventsList";

export const metadata: Metadata = {
  title: "saved events — happening",
  description: "The events you've saved on happening.",
};

export default function SavedPage() {
  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <SavedEventsList />
    </div>
  );
}
