import { useLocation } from "wouter";
import { PeoplePlannerPanel } from "@/components/PeoplePlannerPanel";

export default function PeoplePlannerPage() {
  const [, navigate] = useLocation();

  return (
    <div className="w-full px-6 py-4">
      <PeoplePlannerPanel
        open={true}
        onClose={() => navigate("/app/dashboard")}
      />
    </div>
  );
}
