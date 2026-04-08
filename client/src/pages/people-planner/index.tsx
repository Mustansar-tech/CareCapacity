import { PeoplePlannerPanel } from "@/components/PeoplePlannerPanel";

export default function PeoplePlannerPage() {
  return (
    <div className="w-full px-6 py-4">
      <PeoplePlannerPanel open={true} onClose={() => {}} />
    </div>
  );
}
